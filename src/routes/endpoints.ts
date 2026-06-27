import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/auth";

interface EndpointRow {
  id: number;
  provider_name: string;
  provider_key: string;
  endpoint_url: string;
  status: string;
  latency_ms: number;
  error_rate: number;
  enabled: number;
  display_name: string;
  provider_format: string;
  model_name: string;
  api_key: string;
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function toEndpoint(row: EndpointRow) {
  return {
    ...row,
    api_key_masked: maskKey(row.api_key),
  };
}

export const endpointsRoutes = new Elysia({ prefix: "/api/endpoints" })
  .get("/", ({ headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const rows = db.query("SELECT * FROM endpoints ORDER BY id ASC").all() as EndpointRow[];
    return rows.map(toEndpoint);
  })
  .get("/:id", ({ params: { id }, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const row = db.query("SELECT * FROM endpoints WHERE id = ?").get(id) as EndpointRow | undefined;
    return row ? toEndpoint(row) : null;
  })
  .post("/", ({ body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { display_name, provider_name, provider_key, endpoint_url, model_name, api_key,
      price_input_per_m, price_output_per_m, price_cache_input_per_m } =
      body as {
        display_name: string; provider_name: string; provider_key: string;
        endpoint_url: string; model_name: string; api_key: string;
        price_input_per_m?: number; price_output_per_m?: number;
        price_cache_input_per_m?: number;
      };

    const gatewayKey = "sgw_" + Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

    db.run(
      `INSERT INTO endpoints (display_name, provider_name, provider_key, endpoint_url, model_name, api_key, gateway_key,
        price_input_per_m, price_output_per_m, price_cache_input_per_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [display_name, provider_name, provider_key, endpoint_url, model_name, api_key, gatewayKey,
        price_input_per_m || 0, price_output_per_m || 0, price_cache_input_per_m || 0]
    );
    const row = db.query("SELECT * FROM endpoints ORDER BY id DESC LIMIT 1").get() as EndpointRow;
    return toEndpoint(row);
  })
  .put("/:id", ({ params: { id }, body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const fields = body as Record<string, unknown>;
    const allowedFields = [
      "provider_name", "provider_key", "endpoint_url", "status", "latency_ms",
      "error_rate", "enabled", "display_name", "provider_format", "model_name", "api_key",
      "price_input_per_m", "price_output_per_m", "price_cache_input_per_m",
    ];
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        values.push(fields[f] as string | number | null);
      }
    }
    if (setClauses.length > 0) {
      setClauses.push("updated_at = datetime('now')");
      values.push(id);
      db.run(`UPDATE endpoints SET ${setClauses.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
    }
    const row = db.query("SELECT * FROM endpoints WHERE id = ?").get(id) as EndpointRow | undefined;
    return row ? toEndpoint(row) : null;
  })
  .delete("/:id", ({ params: { id }, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    db.run("DELETE FROM endpoints WHERE id = ?", [id]);
    return { success: true };
  })
  // Test endpoint connection (auto-detects OpenAI vs Anthropic format)
  .post("/test", async ({ body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const { base_url, api_key, model_name } = body as {
      base_url: string;
      api_key: string;
      model_name: string;
    };

    if (!base_url || !api_key) {
      return new Response(JSON.stringify({ error: "base_url 和 api_key 不能为空" }), { status: 400 });
    }

    const normalizedBase = base_url.replace(/\/+$/, "");
    const testModel = model_name || "gpt-4o-mini";

    // Try OpenAI format first, then Anthropic
    const openaiResult = await tryOpenAI(normalizedBase, api_key, testModel);
    if (openaiResult.ok) return openaiResult;

    const anthropicResult = await tryAnthropic(normalizedBase, api_key, testModel);
    return anthropicResult;
  });

async function tryOpenAI(baseUrl: string, apiKey: string, model: string) {
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "openai" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `OpenAI 格式认证失败 (HTTP ${res.status})` };
    }
    // Other errors - let's try Anthropic
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function tryAnthropic(baseUrl: string, apiKey: string, model: string) {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 5,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "anthropic" };
}
