import { Elysia } from "elysia";
import { sessionsRoutes } from "./routes/sessions";
import { logsRoutes } from "./routes/logs";
import { endpointsRoutes } from "./routes/endpoints";
import { usageRoutes } from "./routes/usage";
import { authRoutes } from "./routes/auth";
import { getDb } from "./db";
import index from "./index.html";

// Initialize database on startup
getDb();

// Gateway proxy helpers
interface EndpointRow {
  endpoint_url: string;
  api_key: string;
  model_name: string;
  provider_name: string;
  price_input_per_m: number;
  price_output_per_m: number;
  price_cache_input_per_m: number;
}

function lookupEndpoint(gatewayKey: string): EndpointRow | null {
  if (!gatewayKey) return null;
  const db = getDb();
  return db.query(
    "SELECT endpoint_url, api_key, model_name, provider_name, price_input_per_m, price_output_per_m, price_cache_input_per_m FROM endpoints WHERE gateway_key = ? AND enabled = 1"
  ).get(gatewayKey) as EndpointRow | null;
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

function calcCost(ep: EndpointRow, usage: UsageInfo): string {
  const { inputTokens, outputTokens, cacheHitTokens, cacheMissTokens } = usage;
  if (!ep.price_input_per_m && !ep.price_output_per_m) return "$0.00";
  // cache hit tokens priced at cache rate, miss tokens at normal input rate
  const cacheHitCost = cacheHitTokens * (ep.price_cache_input_per_m || 0) / 1_000_000;
  const missTokens = cacheMissTokens || (inputTokens - cacheHitTokens);
  const inputCost = Math.max(0, missTokens) * (ep.price_input_per_m || 0) / 1_000_000;
  const outputCost = outputTokens * (ep.price_output_per_m || 0) / 1_000_000;
  const total = cacheHitCost + inputCost + outputCost;
  return "$" + total.toFixed(6);
}

function logRequest(
  provider: string, model: string, statusCode: number, latencyMs: number,
  usage: UsageInfo, cost: string, sessionId?: string, responseBody?: string, requestBody?: string
) {
  const db = getDb();
  db.run(
    "INSERT INTO request_logs (request_id, session_id, provider, model, status_code, latency_ms, tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens, cost, response_body, request_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      crypto.randomUUID(), sessionId || null, provider, model, statusCode, latencyMs,
      usage.inputTokens + usage.outputTokens,
      usage.cacheHitTokens, usage.cacheMissTokens, cost,
      responseBody || "",
      requestBody || "",
    ]
  );
}

interface BodyMessage { role: string; content: unknown }

function createSession(provider: string, model: string, messages: BodyMessage[]): string {
  const db = getDb();
  const id = `sess_${Date.now().toString(36)}`;
  const firstUser = messages.find((m) => m.role === "user");
  const raw = typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content || "");
  const title = raw.slice(0, 60) + (raw.length > 60 ? "…" : "");
  db.run("INSERT INTO sessions (id, title, provider, model, status) VALUES (?, ?, ?, ?, 'live')",
    [id, title || "New Session", provider, model]);
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    db.run("INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, ?, ?, 0, '—')", [id, m.role, text]);
  }
  return id;
}

function finalizeSession(
  sessionId: string,
  response: { text: string; thinking?: string; model?: string; stop_reason?: string; usage?: Record<string, number> },
  totalTokens: number,
  latencyMs: number
) {
  const db = getDb();
  const content = JSON.stringify(response);
  db.run("INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, 'assistant', ?, ?, ?)",
    [sessionId, content, totalTokens, `${latencyMs}ms`]);
  db.run("UPDATE sessions SET status = 'idle', tokens = ?, latency = ?, updated_at = datetime('now') WHERE id = ?",
    [totalTokens, `${latencyMs}ms`, sessionId]);
}

async function proxyOpenAI(gatewayKey: string, request: Request, set: { status: number; headers: Record<string, string> }) {
  const ep = lookupEndpoint(gatewayKey);
  if (!ep) { set.status = 401; return { error: "Invalid or disabled API key" }; }

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { set.status = 400; return { error: "Invalid JSON body" }; }

  const baseUrl = ep.endpoint_url.replace(/\/+$/, "");
  const model = (body.model || ep.model_name) as string;
  const start = Date.now();
  const isStream = !!body.stream;
  const reqMessages = (body.messages as BodyMessage[] | undefined) || [];
  const sessionId = createSession(ep.provider_name || baseUrl, model, reqMessages);

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ep.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model }),
    });

    if (isStream && upstream.body) {
      set.status = upstream.status;
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["X-Accel-Buffering"] = "no";
      const upstreamBody = upstream.body;
      const stream = new ReadableStream({
        async start(controller) {
          const reader = upstreamBody.getReader();
          let buffer = "";
          let assistantText = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = new TextDecoder().decode(value);
              buffer += chunk;
              controller.enqueue(value);
            }
            let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
            let responseModel = "";
            let stopReason = "";
            for (const line of buffer.split("\n")) {
              if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                try {
                  const j = JSON.parse(line.slice(6));
                  if (j.usage) {
                    usage = {
                      inputTokens: j.usage.prompt_tokens || 0,
                      outputTokens: j.usage.completion_tokens || 0,
                      cacheHitTokens: j.usage.prompt_cache_hit_tokens || 0,
                      cacheMissTokens: j.usage.prompt_cache_miss_tokens || 0,
                    };
                  }
                  if (j.model && !responseModel) responseModel = j.model;
                  if (j.choices?.[0]?.finish_reason) stopReason = j.choices[0].finish_reason;
                  const delta = j.choices?.[0]?.delta?.content;
                  if (delta) assistantText += delta;
                } catch { /* */ }
              }
            }
            const cost = calcCost(ep, usage);
            const totalTokens = usage.inputTokens + usage.outputTokens;
            logRequest(ep.provider_name, model, upstream.status, Date.now() - start, usage, cost, sessionId, buffer, JSON.stringify(body));
            finalizeSession(sessionId, {
              text: assistantText,
              model: responseModel || (model as string),
              stop_reason: stopReason,
              usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
            }, totalTokens, Date.now() - start);
          } finally {
            reader.releaseLock();
            controller.close();
          }
        },
      });
      return new Response(stream, { status: upstream.status, headers: set.headers });
    }

    const text = await upstream.text();
    const latencyMs = Date.now() - start;

    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    let assistantText = "";
    let responseModel = "";
    let stopReason = "";
    try {
      const j = JSON.parse(text);
      usage = {
        inputTokens: j.usage?.prompt_tokens || 0,
        outputTokens: j.usage?.completion_tokens || 0,
        cacheHitTokens: j.usage?.prompt_cache_hit_tokens || 0,
        cacheMissTokens: j.usage?.prompt_cache_miss_tokens || 0,
      };
      assistantText = j.choices?.[0]?.message?.content || text;
      responseModel = j.model || "";
      stopReason = j.choices?.[0]?.finish_reason || "";
    } catch { /* */ }

    const cost = calcCost(ep, usage);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    logRequest(ep.provider_name, model, upstream.status, latencyMs, usage, cost, sessionId, text, JSON.stringify(body));
    finalizeSession(sessionId, {
      text: assistantText,
      model: responseModel || (model as string),
      stop_reason: stopReason,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
    }, totalTokens, latencyMs);

    set.status = upstream.status;
    set.headers["Content-Type"] = "application/json";
    return text;
  } catch (err: unknown) {
    set.status = 502;
    return { error: `Upstream error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function proxyAnthropic(gatewayKey: string, request: Request, set: { status: number; headers: Record<string, string> }) {
  const ep = lookupEndpoint(gatewayKey);
  if (!ep) { set.status = 401; return { error: "Invalid or disabled API key" }; }

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { set.status = 400; return { error: "Invalid JSON body" }; }

  const baseUrl = ep.endpoint_url.replace(/\/+$/, "");
  const model = (body.model || ep.model_name) as string;
  const start = Date.now();
  const isStream = !!body.stream;
  const reqMessages = (body.messages as BodyMessage[] | undefined) || [];
  const sessionId = createSession(ep.provider_name || baseUrl, model, reqMessages);

  try {
    const upstream = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": ep.api_key,
        "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, model }),
    });

    if (isStream && upstream.body) {
      set.status = upstream.status;
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["X-Accel-Buffering"] = "no";
      const upstreamBody = upstream.body;
      const stream = new ReadableStream({
        async start(controller) {
          const reader = upstreamBody.getReader();
          let buffer = "";
          let assistantText = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = new TextDecoder().decode(value);
              buffer += chunk;
              controller.enqueue(value);
            }
            let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
            let thinkingText = "";
            let responseModel = "";
            let stopReason = "";
            for (const line of buffer.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const j = JSON.parse(line.slice(6));
                  if (j.usage) {
                    usage = {
                      inputTokens: j.usage.input_tokens || 0,
                      outputTokens: j.usage.output_tokens || 0,
                      cacheHitTokens: j.usage.prompt_cache_hit_tokens || 0,
                      cacheMissTokens: j.usage.prompt_cache_miss_tokens || 0,
                    };
                  }
                  if (j.type === "message_start" && j.message?.model && !responseModel) {
                    responseModel = j.message.model;
                  }
                  if (j.type === "message_delta" && j.delta?.stop_reason) {
                    stopReason = j.delta.stop_reason;
                  }
                  if (j.type === "content_block_delta" && j.delta?.text) {
                    assistantText += j.delta.text;
                  }
                  if (j.type === "content_block_delta" && j.delta?.thinking) {
                    thinkingText += j.delta.thinking;
                  }
                } catch { /* */ }
              }
            }
            const cost = calcCost(ep, usage);
            const totalTokens = usage.inputTokens + usage.outputTokens;
            logRequest(ep.provider_name, model, upstream.status, Date.now() - start, usage, cost, sessionId, buffer, JSON.stringify(body));
            finalizeSession(sessionId, {
              text: assistantText,
              thinking: thinkingText || undefined,
              model: responseModel || (model as string),
              stop_reason: stopReason,
              usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
            }, totalTokens, Date.now() - start);
          } finally {
            reader.releaseLock();
            controller.close();
          }
        },
      });
      return new Response(stream, { status: upstream.status, headers: set.headers });
    }

    const text = await upstream.text();
    const latencyMs = Date.now() - start;

    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    let assistantText = "";
    let thinkingText = "";
    let responseModel = "";
    let stopReason = "";
    try {
      const j = JSON.parse(text);
      usage = {
        inputTokens: j.usage?.input_tokens || 0,
        outputTokens: j.usage?.output_tokens || 0,
        cacheHitTokens: j.usage?.prompt_cache_hit_tokens || 0,
        cacheMissTokens: j.usage?.prompt_cache_miss_tokens || 0,
      };
      // Anthropic content is an array of blocks: [{type:"text",text:"..."}, {type:"thinking",thinking:"..."}]
      const blocks = j.content as Array<{ type: string; text?: string; thinking?: string }> | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "text" && b.text) assistantText += b.text;
          if (b.type === "thinking" && b.thinking) thinkingText += b.thinking;
        }
      }
      if (!assistantText) assistantText = text;
      responseModel = j.model || "";
      stopReason = j.stop_reason || "";
    } catch { /* */ }

    const cost = calcCost(ep, usage);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    logRequest(ep.provider_name, model, upstream.status, latencyMs, usage, cost, sessionId, text, JSON.stringify(body));
    finalizeSession(sessionId, {
      text: assistantText,
      thinking: thinkingText || undefined,
      model: responseModel || (model as string),
      stop_reason: stopReason,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
    }, totalTokens, latencyMs);

    set.status = upstream.status;
    set.headers["Content-Type"] = "application/json";
    return text;
  } catch (err: unknown) {
    set.status = 502;
    return { error: `Upstream error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// === Environment & Port ===
const isProduction = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// === Frontend dev server with HMR (internal port, dev only) ===
if (!isProduction) {
  Bun.serve({
    port: PORT + 1,
    routes: { "/*": index },
    development: { hmr: true },
  });
}

const app = new Elysia()
  // API routes first (matched before catch-all)
  .use(sessionsRoutes)
  .use(logsRoutes)
  .use(endpointsRoutes)
  .use(usageRoutes)
  .use(authRoutes)
  .get("/api/health", () => ({ status: "ok", time: new Date().toISOString() }))
  // Gateway proxy: external clients connect via /v1/*
  // OpenAI-compatible: POST /v1/chat/completions
  .post("/v1/chat/completions", async ({ request, set }) => {
    const auth = request.headers.get("Authorization") || "";
    const gatewayKey = auth.replace(/^Bearer\s+/i, "");
    const proxySet = { status: 200, headers: {} as Record<string, string> };
    const result = await proxyOpenAI(gatewayKey, request, proxySet);
    set.status = proxySet.status;
    Object.assign(set.headers, proxySet.headers);
    return result;
  })
  // Anthropic-compatible: POST /anthropic/v1/messages
  .post("/anthropic/v1/messages", async ({ request, set }) => {
    const gatewayKey = request.headers.get("x-api-key") || "";
    const proxySet = { status: 200, headers: {} as Record<string, string> };
    const result = await proxyAnthropic(gatewayKey, request, proxySet);
    set.status = proxySet.status;
    Object.assign(set.headers, proxySet.headers);
    return result;
  });

// === Production: serve built frontend (dist/) + API directly via Elysia ===
if (isProduction) {
  // Resolve dist relative to this file so cwd doesn't matter.
  const distDir = new URL("../dist/", import.meta.url).pathname;
  app.get("*", async ({ set, path }) => {
    // path is like "/index-abc.js" or "/"
    const rel = path === "/" ? "/index.html" : path;
    const filePath = distDir + rel.replace(/^\//, "");
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = rel.split(".").pop() || "";
      const mime: Record<string, string> = {
        html: "text/html; charset=utf-8",
        css: "text/css",
        js: "application/javascript",
        map: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
        json: "application/json",
        woff: "font/woff",
        woff2: "font/woff2",
      };
      set.headers["Content-Type"] = mime[ext] || "application/octet-stream";
      return file;
    }
    // SPA fallback for client-side routes
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return Bun.file(distDir + "index.html");
  });
  app.listen({ port: PORT, hostname: HOST });
  console.log(`🚀 Pulse AI Gateway running on http://${HOST}:${PORT} (production)`);
} else {
  // === Dev: Bun.serve with HMR proxy ===
  Bun.serve({
    port: PORT,
    websocket: {
      open(ws) {
        const target = new WebSocket(`ws://localhost:${PORT + 1}/_bun/hmr`);
        (ws as unknown as { data: { target: WebSocket } }).data = { target };
        target.addEventListener("message", (e) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        });
        target.addEventListener("close", () => ws.close());
      },
      message(ws, message) {
        const data = ws.data as { target: WebSocket } | undefined;
        if (data?.target && data.target.readyState === WebSocket.OPEN) {
          data.target.send(message);
        }
      },
      close(ws) {
        const data = ws.data as { target: WebSocket } | undefined;
        data?.target?.close();
      },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      // Proxy /_bun/hmr WebSocket upgrade to HMR server
      if (url.pathname === "/_bun/hmr" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        if (server.upgrade(req)) return;
      }
      // Proxy frontend requests to HMR server
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/anthropic/")) {
        const target = new URL(req.url);
        target.port = `${PORT + 1}`;
        return fetch(target, req);
      }
      // Delegate API requests to Elysia
      return app.fetch(req);
    },
  });
  console.log(`🔥 Pulse AI Gateway running on http://localhost:${PORT} (dev + HMR)`);
}
