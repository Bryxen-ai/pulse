import { useState, useEffect } from "react";
import { t, useTranslation } from "../i18n";
import type { UsageStats } from "../types";

interface ModelBreakdown {
  model: string;
  provider: string;
  requests: number;
  tokens: number;
  avg_latency: number;
  cost: string;
}

interface TrendPoint {
  day: string;
  provider: string;
  tokens: number;
}

const CHART_W = 780;
const CHART_H = 200;
const CHART_L = 50; // left padding

const providerColors: Record<string, string> = {
  OpenAI: "#3b82f6",      // blue
  Anthropic: "#8b5cf6",   // purple
  deepseek: "#10b981",    // green
  flash: "#f59e0b",       // amber
  default: "#6366f1",     // indigo
};

function renderChart(trend: TrendPoint[]) {
  if (trend.length === 0) return null;

  // Group by day
  const dayMap = new Map<string, Record<string, number>>();
  const providers = new Set<string>();
  for (const p of trend) {
    providers.add(p.provider);
    if (!dayMap.has(p.day)) dayMap.set(p.day, {});
    dayMap.get(p.day)![p.provider] = p.tokens;
  }
  const days = [...dayMap.keys()].sort();
  const providerList = [...providers];

  // Find max tokens for scaling
  let maxTokens = 0;
  for (const p of trend) {
    if (p.tokens > maxTokens) maxTokens = p.tokens;
  }
  if (maxTokens === 0) maxTokens = 1;

  const scaleY = (v: number) => CHART_H - (v / maxTokens) * (CHART_H - 20);
  // When only one day: center the point. Otherwise: distribute evenly.
  const stepX = days.length > 1 ? (CHART_W - CHART_L - 80) / (days.length - 1) : 0;
  const singleDayX = (CHART_W - CHART_L) / 2 + CHART_L;
  const getX = (di: number) =>
    days.length === 1 ? singleDayX : CHART_L + di * stepX;

  // Y-axis labels
  const yLabels = [0, Math.round(maxTokens * 0.5), maxTokens];
  const formatY = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`;

  const dayLabels = days.map((d) => {
    const date = new Date(d + "T00:00:00");
    return [t("day.sun"), t("day.mon"), t("day.tue"), t("day.wed"), t("day.thu"), t("day.fri"), t("day.sat")][date.getDay()];
  });

  return (
    <svg className="chart-area" viewBox={`0 0 ${CHART_W} 240`} preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yLabels.map((v, i) => {
        const y = scaleY(v);
        return (
          <g key={i}>
            <line x1={CHART_L} y1={y} x2={CHART_W} y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray={i === 0 ? "" : "4 4"} />
            <text x={CHART_L - 6} y={y + 4} fontSize="10" fill="#6b7280" textAnchor="end">{formatY(v)}</text>
          </g>
        );
      })}

      {/* Lines per provider */}
      {providerList.map((provider, pi) => {
        const pointCoords = days.map((day, di) => ({
          x: getX(di),
          y: scaleY(dayMap.get(day)?.[provider] || 0),
          v: dayMap.get(day)?.[provider] || 0,
        }));
        const points = pointCoords.map((p) => `${p.x},${p.y}`);
        const color = providerColors[provider] || providerColors.default;
        const legendX = CHART_W - (providerList.length - pi) * 90;
        const lastPoint = pointCoords[pointCoords.length - 1];
        const lastDay = days[days.length - 1] ?? "";
        const legendY = scaleY(dayMap.get(lastDay)?.[provider] || 0) - 6;
        return (
          <g key={provider}>
            {/* Filled area only when we have 2+ points */}
            {days.length > 1 && (
              <polygon
                points={`${CHART_L},${CHART_H} ${points.join(" ")} ${getX(days.length - 1)},${CHART_H}`}
                fill={color}
                fillOpacity="0.12"
              />
            )}
            {/* Line only when we have 2+ points */}
            {days.length > 1 && (
              <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2" />
            )}
            {/* Dots for every data point (also makes single-day visible) */}
            {pointCoords.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} />
            ))}
            {/* Value label next to the single point */}
            {days.length === 1 && lastPoint && (
              <text x={lastPoint.x + 8} y={lastPoint.y + 4} fontSize="11" fill={color} fontWeight="600">
                {formatY(lastPoint.v)}
              </text>
            )}
            <text x={legendX} y={legendY} fontSize="11" fill={color} textAnchor="end" fontWeight="600">
              {provider}
            </text>
          </g>
        );
      })}

      {/* Day labels */}
      {days.map((day, di) => (
        <text key={day} x={getX(di)} y={218} fontSize="10" fill="#6b7280" textAnchor="middle">{dayLabels[di]}</text>
      ))}
    </svg>
  );
}

interface UsageProps {
  token: string;
}

export function Usage({ token }: UsageProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<UsageStats>({
    totalTokens: "—",
    totalRequests: "—",
    avgLatency: "—",
    estimatedCost: "—",
    cacheHitRate: "—",
  });
  const [breakdown, setBreakdown] = useState<ModelBreakdown[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };

    fetch("/api/usage/stats", { headers })
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);

    fetch("/api/usage/by-model", { headers })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBreakdown(data);
      })
      .catch(console.error);

    fetch("/api/usage/trend", { headers })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTrend(data);
      })
      .catch(console.error);
  }, [token]);

  return (
    <section className="section active" style={{ overflowY: "auto", padding: "24px" }}>
      <div className="filter-bar">
        <select>
          <option>{t("usage.last7d")}</option>
          <option>{t("usage.last24h")}</option>
          <option>{t("usage.last30d")}</option>
        </select>
        <select>
          <option>{t("usage.allProviders")}</option>
          <option>OpenAI</option>
          <option>Anthropic</option>
        </select>
        <select>
          <option>{t("usage.allModels")}</option>
          <option>gpt-4o</option>
          <option>gpt-4o-mini</option>
          <option>claude-sonnet-4</option>
          <option>claude-3-5-haiku</option>
        </select>
      </div>

      <div className="grid-5" style={{ marginBottom: "18px" }}>
        <div className="stat-card">
          <div className="stat-label">{t("usage.totalTokens")}</div>
          <div className="stat-value">{stats.totalTokens}</div>
          <div className="stat-sub" style={{ color: "var(--green)" }}>
            &nbsp;
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("usage.totalRequests")}</div>
          <div className="stat-value">{stats.totalRequests}</div>
          <div className="stat-sub">&nbsp;</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("usage.avgLatency")}</div>
          <div className="stat-value">{stats.avgLatency}</div>
          <div className="stat-sub" style={{ color: "var(--green)" }}>
            &nbsp;
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("usage.cacheHitRate")}</div>
          <div className="stat-value">{stats.cacheHitRate}</div>
          <div className="stat-sub" style={{ color: "var(--green)" }}>
            prompt cache
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("usage.estimatedCost")}</div>
          <div className="stat-value">{stats.estimatedCost}</div>
          <div className="stat-sub">&nbsp;</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "18px" }}>
        <div className="card-header">
          <h3>{t("usage.tokenTrend")}</h3>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>{t("usage.unitTokens")}</span>
        </div>
        {trend.length > 0 ? (
          renderChart(trend)
        ) : (
          <div style={{ height: "240px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "13px" }}>
            {t("usage.noData")}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{t("usage.byModel")}</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("usage.colModel")}</th>
                <th>{t("usage.colProvider")}</th>
                <th>{t("usage.colRequests")}</th>
                <th>{t("usage.colTokens")}</th>
                <th>{t("usage.colAvgLatency")}</th>
                <th>{t("usage.colCost")}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length > 0
                ? breakdown.map((b, i) => (
                    <tr key={i}>
                      <td className="mono">{b.model}</td>
                      <td>{b.provider}</td>
                      <td className="mono">{b.requests.toLocaleString()}</td>
                      <td className="mono">{(b.tokens / 1_000_000).toFixed(1)}M</td>
                      <td className="mono">{Math.round(b.avg_latency)}ms</td>
                      <td className="mono">{b.cost || `$${(b.tokens * 0.000015).toFixed(0)}`}</td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "24px" }}>{t("usage.noData")}</td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
