import { useState, useEffect, Fragment } from "react";
import { t, useTranslation } from "../i18n";
import type { Endpoint } from "../types";

interface AddModalProps {
  onClose: () => void;
  onCreated: () => void;
  token: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  font: "13px var(--font)",
  background: "var(--bg)",
  color: "var(--fg)",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--muted)",
  display: "block",
  marginBottom: "4px",
};

function AddModal({ onClose, onCreated, token }: AddModalProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priceInputPerM, setPriceInputPerM] = useState("");
  const [priceOutputPerM, setPriceOutputPerM] = useState("");
  const [priceCacheInputPerM, setPriceCacheInputPerM] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Created endpoint info
  const [createdEndpoint, setCreatedEndpoint] = useState<Endpoint | null>(null);

  // Testing
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const testConnection = async () => {
    if (!endpointUrl || !apiKey) {
      setError(t("ep.testFillFirst"));
      return;
    }
    setError("");
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch("/api/endpoints/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          base_url: endpointUrl,
          api_key: apiKey,
          model_name: modelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, msg: data.error || t("ep.testFailed") });
        return;
      }
      setTestResult({
        ok: true,
        msg: t("ep.testSuccess", { latency: data.latency_ms, model: data.model_used }),
      });
    } catch {
      setTestResult({ ok: false, msg: t("ep.testNetworkError") });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/endpoints", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          display_name: displayName,
          provider_name: providerName,
          provider_key: providerKey,
          endpoint_url: endpointUrl,
          model_name: modelName,
          api_key: apiKey,
          price_input_per_m: priceInputPerM ? parseFloat(priceInputPerM) : 0,
          price_output_per_m: priceOutputPerM ? parseFloat(priceOutputPerM) : 0,
          price_cache_input_per_m: priceCacheInputPerM ? parseFloat(priceCacheInputPerM) : 0,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || t("ep.addFailed"));
        return;
      }
      const ep = await res.json() as Endpoint;
      setCreatedEndpoint(ep);
      onCreated();
    } catch {
      setError(t("ep.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 500,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "520px", maxWidth: "92%", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 650 }}>{t("ep.addEndpoint")}</h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "18px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {createdEndpoint ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{
              padding: "14px", borderRadius: "var(--radius-sm)",
              background: "oklch(95% 0.06 160)", color: "var(--green)",
              fontSize: "13px", fontWeight: 600,
            }}>
              ✓ {t("ep.created")}
            </div>

            <div style={{
              padding: "16px", borderRadius: "var(--radius-sm)",
              background: "oklch(97% 0.01 250)", border: "1px solid var(--border)",
            }}>
              <h4 style={{ fontSize: "13px", fontWeight: 650, marginBottom: "12px" }}>{t("ep.externalInfo")}</h4>

              {[
                { label: "Gateway Base URL", value: window.location.origin + "/v1", mono: true },
                { label: "API Key", value: createdEndpoint.gateway_key, mono: true },
                { label: "Model", value: createdEndpoint.model_name || createdEndpoint.provider_name, mono: true },
              ].map((item) => (
                <div key={item.label} style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "2px" }}>{item.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <code style={{
                      flex: 1, padding: "6px 10px", fontSize: "12px",
                      background: "var(--bg)", borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)", wordBreak: "break-all",
                    }}>
                      {item.value}
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(item.value)}
                      style={{
                        padding: "4px 10px", fontSize: "11px", cursor: "pointer",
                        background: "var(--accent)", color: "#fff", border: "none",
                        borderRadius: "var(--radius-sm)", whiteSpace: "nowrap",
                      }}
                    >
                      {t("ep.copy")}
                    </button>
                  </div>
                </div>
              ))}

              <div style={{
                marginTop: "12px", padding: "10px", borderRadius: "var(--radius-sm)",
                background: "oklch(96% 0.02 250)", fontSize: "12px", color: "var(--muted)",
              }}>
                <strong>{t("ep.curlExample")}</strong><br />
                <code style={{ fontSize: "11px" }}>
                  curl {window.location.origin}/v1/chat/completions \<br />
                  &nbsp;&nbsp;-H "Authorization: Bearer {createdEndpoint.gateway_key}" \<br />
                  &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                  &nbsp;&nbsp;-d '{`{"model":"${createdEndpoint.model_name}","messages":[{"role":"user","content":"hello"}]}`}'
                </code>
              </div>
            </div>

            <button type="button" className="btn btn-primary" onClick={onClose} style={{ alignSelf: "flex-end" }}>
              {t("ep.cancel")}
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "oklch(95% 0.04 25)", color: "var(--red)", fontSize: "13px" }}>
              {error}
            </div>
          )}

          {/* Custom Display Name */}
          <div>
            <label style={labelStyle}>{t("ep.customName")}</label>
            <input
              type="text"
              placeholder={t("ep.customNameHint")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* Provider Name + Key in one row */}
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>{t("ep.providerName")}</label>
              <input
                type="text"
                placeholder={t("ep.providerKeyIdHint")}
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("ep.providerKeyId")}</label>
              <input
                type="text"
                placeholder={t("ep.providerKeyHint")}
                value={providerKey}
                onChange={(e) => setProviderKey(e.target.value.toUpperCase().slice(0, 3))}
                required
                style={inputStyle}
              />
            </div>
          </div>

          {/* Base URL + API Key */}
          <div>
            <label style={labelStyle}>Base URL *</label>
            <input
              type="url"
              placeholder={t("ep.baseUrlHint")}
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>API Key *</label>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* Model Name */}
          <div>
            <label style={labelStyle}>Model *</label>
            <input
              type="text"
              placeholder={t("ep.modelHint")}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* Pricing Configuration */}
          <div style={{ padding: "12px", borderRadius: "var(--radius-sm)", background: "oklch(97% 0.01 250)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "12px", fontWeight: 650, marginBottom: "8px", color: "var(--fg)" }}>{t("ep.pricingConfig")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={labelStyle}>{t("ep.priceInput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceInputPerM}
                  onChange={(e) => setPriceInputPerM(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("ep.priceOutput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceOutputPerM}
                  onChange={(e) => setPriceOutputPerM(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("ep.priceCacheInput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceCacheInputPerM}
                  onChange={(e) => setPriceCacheInputPerM(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* Test Connection */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !endpointUrl || !apiKey}
              className="btn btn-sm"
              style={{
                fontSize: "12px",
                padding: "6px 16px",
                opacity: testing ? 0.6 : 1,
                background: testing ? "var(--muted)" : "var(--green)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: testing ? "not-allowed" : "pointer",
              }}
            >
              {testing ? t("ep.testConnecting") : t("ep.testConnection")}
            </button>
            {testResult && (
              <span style={{
                fontSize: "12px",
                color: testResult.ok ? "var(--green)" : "var(--red)",
                fontWeight: 500,
              }}>
                {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
              </span>
            )}
          </div>

          {/* Submit */}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" className="btn" style={{ border: "1px solid var(--border)" }} onClick={onClose}>
              {t("ep.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t("ep.submitting") : t("ep.confirm")}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

function TestPanel({ ep }: { ep: Endpoint }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [status, setStatus] = useState<number | null>(null);
  const [format, setFormat] = useState<"openai" | "anthropic">("openai");

  const curlOpenAI = `curl ${window.location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${ep.gateway_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${ep.model_name}","messages":[{"role":"user","content":"hello"}]}'`;

  const curlAnthropic = `curl ${window.location.origin}/anthropic/v1/messages \\
  -H "x-api-key: ${ep.gateway_key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${ep.model_name}","max_tokens":100,"messages":[{"role":"user","content":"hello"}]}'`;

  const curlCmd = format === "openai" ? curlOpenAI : curlAnthropic;

  const execute = async () => {
    setRunning(true);
    setResult("");
    setStatus(null);
    try {
      const endpoint = format === "openai" ? "/v1/chat/completions" : "/anthropic/v1/messages";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (format === "openai") {
        headers["Authorization"] = `Bearer ${ep.gateway_key}`;
      } else {
        headers["x-api-key"] = ep.gateway_key;
        headers["anthropic-version"] = "2023-06-01";
      }
      const body = format === "openai"
        ? { model: ep.model_name, messages: [{ role: "user", content: "hello" }] }
        : { model: ep.model_name, max_tokens: 100, messages: [{ role: "user", content: "hello" }] };

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      setStatus(res.status);
      const text = await res.text();
      try { setResult(JSON.stringify(JSON.parse(text), null, 2)); }
      catch { setResult(text); }
    } catch (err: unknown) {
      setStatus(0);
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{
      padding: "16px", borderRadius: "var(--radius)", background: "oklch(99% 0.005 250)",
      border: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => { setFormat("openai"); setResult(""); setStatus(null); }}
            style={{
              padding: "4px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
              border: "1px solid var(--accent)",
              background: format === "openai" ? "var(--accent)" : "transparent",
              color: format === "openai" ? "#fff" : "var(--accent)",
            }}
          >
            OpenAI
          </button>
          <button
            onClick={() => { setFormat("anthropic"); setResult(""); setStatus(null); }}
            style={{
              padding: "4px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
              border: "1px solid var(--amber)",
              background: format === "anthropic" ? "var(--amber)" : "transparent",
              color: format === "anthropic" ? "#fff" : "var(--amber)",
            }}
          >
            Anthropic
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => navigator.clipboard.writeText(curlCmd)}
            className="btn btn-sm"
            style={{ fontSize: "11px", padding: "3px 10px", border: "1px solid var(--border)" }}
          >
            {t("ep.copyCurl")}
          </button>
          <button
            onClick={execute}
            disabled={running}
            className="btn btn-sm"
            style={{
              fontSize: "11px", padding: "3px 14px",
              background: running ? "var(--muted)" : "var(--green)",
              color: "#fff", border: "none", borderRadius: "var(--radius-sm)",
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? t("ep.running") : t("ep.run")}
          </button>
        </div>
      </div>

      <pre style={{
        margin: "0 0 12px", padding: "12px", fontSize: "12px", lineHeight: "1.6",
        background: "oklch(25% 0.01 250)", color: "oklch(90% 0.01 100)",
        borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>
        <code>{curlCmd}</code>
      </pre>

      {status !== null && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px",
            fontSize: "12px", fontWeight: 600,
            color: status >= 200 && status < 300 ? "var(--green)" : "var(--red)",
          }}>
            <span>HTTP {status === 0 ? "Error" : status}</span>
            {status >= 200 && status < 300 && <span>{t("ep.testSuccessLabel")}</span>}
            {status >= 400 && <span>{t("ep.testFailLabel")}</span>}
          </div>
          <pre style={{
            margin: 0, padding: "12px", fontSize: "12px", lineHeight: "1.5",
            background: "oklch(97% 0.005 250)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "pre-wrap",
            wordBreak: "break-all", maxHeight: "300px", overflowY: "auto",
          }}>
            <code>{result || t("logs.emptyResponse")}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

export function Endpoints({ token }: { token: string }) {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchEndpoints = () => {
    fetch("/api/endpoints", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEndpoints(data);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchEndpoints();
  }, []);

  const toggleEnabled = async (ep: Endpoint) => {
    const newEnabled = ep.enabled ? 0 : 1;
    await fetch(`/api/endpoints/${ep.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    fetchEndpoints();
  };

  const providerColor = (key: string) => {
    if (key === "OA") return "#10a37f";
    if (key === "AN") return "#d97757";
    return "var(--accent)";
  };

  return (
    <section className="section active" style={{ overflowY: "auto", padding: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <p style={{ color: "var(--muted)", fontSize: "13px" }}>{t("ep.title")}</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>{t("ep.add")}</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("ep.colName")}</th>
              <th>{t("ep.colProvider")}</th>
              <th>{t("ep.colEndpointUrl")}</th>
              <th>{t("ep.colModel")}</th>
              <th>{t("ep.colStatus")}</th>
              <th>{t("ep.colLatency")}</th>
              <th>{t("ep.colErrorRate")}</th>
              <th>{t("ep.colEnabled")}</th>
              <th style={{ width: "40px" }}></th>
            </tr>
          </thead>
          <tbody>
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: "24px" }}>{t("ep.noEndpoints")}</td>
              </tr>
            ) : endpoints.map((ep) => (
              <Fragment key={ep.id}>
              <tr>
                <td style={{ fontWeight: 600 }}>{ep.display_name || ep.provider_name}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "4px",
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "10px",
                        background: providerColor(ep.provider_key),
                      }}
                    >
                      {ep.provider_key}
                    </span>
                    {ep.provider_name}
                  </div>
                </td>
                <td
                  className="mono"
                  title={t("ep.copy")}
                  style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                  onClick={(e) => {
                    navigator.clipboard.writeText(ep.endpoint_url);
                    const el = e.currentTarget;
                    el.style.color = "var(--green)";
                    setTimeout(() => { el.style.color = ""; }, 600);
                  }}
                >
                  {ep.endpoint_url}
                </td>
                <td
                  className="mono"
                  title={t("ep.copy")}
                  style={{ fontSize: "12px", cursor: "pointer" }}
                  onClick={(e) => {
                    navigator.clipboard.writeText(ep.model_name);
                    const el = e.currentTarget;
                    el.style.color = "var(--green)";
                    setTimeout(() => { el.style.color = ""; }, 600);
                  }}
                >
                  {ep.model_name || "—"}
                </td>
                <td>
                  <span className={`cell-status ${ep.status === "healthy" ? "ok" : "err"}`}>
                    {ep.status === "healthy" ? t("ep.statusHealthy") : t("ep.statusUnhealthy")}
                  </span>
                </td>
                <td className="mono">{ep.latency_ms} ms</td>
                <td className="mono" style={{ color: "var(--green)" }}>
                  {ep.error_rate}%
                </td>
                <td>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={!!ep.enabled}
                      onChange={() => toggleEnabled(ep)}
                    />
                    <span className="slider" />
                  </label>
                </td>
                <td>
                  <button
                    onClick={() => setExpandedId(expandedId === ep.id ? null : ep.id)}
                    className="btn btn-sm"
                    style={{
                      fontSize: "11px", padding: "4px 10px",
                      background: expandedId === ep.id ? "var(--accent)" : "var(--accent-subtle)",
                      color: expandedId === ep.id ? "#fff" : "var(--accent)",
                      border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("ep.testBtn")}
                  </button>
                </td>
              </tr>
              {expandedId === ep.id && (
                <tr key={`${ep.id}-test`}>
                  <td colSpan={9} style={{ padding: "0 8px 12px" }}>
                    <TestPanel ep={ep} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddModal onClose={() => setShowModal(false)} onCreated={fetchEndpoints} token={token} />
      )}
    </section>
  );
}
