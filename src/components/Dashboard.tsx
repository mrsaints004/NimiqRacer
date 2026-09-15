import { useCallback, useEffect, useState } from "react";
import { fetchStatsSummary, type StatsSummary } from "../services/api";

// Read admin secret from URL once, then strip it from the address bar so it
// doesn't leak in browser history, referrer headers, or shoulder-surfing.
function useAdminSecret(): string | undefined {
  const [secret] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("secret") || undefined;
    if (s) {
      params.delete("secret");
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", clean);
    }
    return s;
  });
  return secret;
}

export default function Dashboard() {
  const [data, setData] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const secret = useAdminSecret();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchStatsSummary(secret)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1a3a5c 0%, #2266cc 50%, #77bbff 100%)",
        color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0 }}>Nimiq Racer Dashboard</h1>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={load} style={btnStyle}>
              Refresh
            </button>
            <a href="/" style={{ ...btnStyle, textDecoration: "none" }}>
              Back to Game
            </a>
          </div>
        </div>

        {loading && <p style={{ textAlign: "center", fontSize: 18, opacity: 0.8 }}>Loading...</p>}
        {error && (
          <div style={{ ...cardStyle, background: "rgba(255,60,60,0.25)" }}>
            <p style={{ margin: 0 }}>Error: {error}</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
              <KpiCard label="Total Sessions" value={data.totalSessions} />
              <KpiCard label="Unique Players" value={data.uniquePlayers} />
              <KpiCard label="Avg Score" value={data.avgScore} />
              <KpiCard label="Max Score" value={data.maxScore} />
              <KpiCard label="Sessions Today" value={data.sessionsToday} />
              <KpiCard label="Sessions (7d)" value={data.sessionsLast7Days} />
              <KpiCard label="Completion Rate" value={data.completionRate != null ? `${data.completionRate}%` : "N/A"} />
              <KpiCard label="Total Coins" value={data.totalCoins} />
              <KpiCard label="Game Starts" value={data.gameStarts} />
            </div>

            {/* Top players */}
            <div style={{ ...cardStyle, marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 0, marginBottom: 16 }}>Top Players</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "Player", "Best Score", "Games", "Verified"].map((h) => (
                      <th key={h} style={thStyle}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.topPlayers.map((p, i) => (
                    <tr key={p.username}>
                      <td style={tdStyle}>{i + 1}</td>
                      <td style={tdStyle}>{p.username}</td>
                      <td style={tdStyle}>{p.bestScore.toLocaleString()}</td>
                      <td style={tdStyle}>{p.games}</td>
                      <td style={tdStyle}>{p.verified ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                  {data.topPlayers.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: "center", opacity: 0.6 }}>
                        No data yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Event breakdown */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 0, marginBottom: 16 }}>Event Breakdown</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Event Type</th>
                    <th style={thStyle}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eventBreakdown.map((e) => (
                    <tr key={e.type}>
                      <td style={tdStyle}>{e.type}</td>
                      <td style={tdStyle}>{Number(e.count).toLocaleString()}</td>
                    </tr>
                  ))}
                  {data.eventBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ ...tdStyle, textAlign: "center", opacity: 0.6 }}>
                        No events yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  borderRadius: 16,
  padding: 20,
  backdropFilter: "blur(8px)",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  fontSize: 14,
  fontWeight: "bold",
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.15)",
  fontSize: 13,
  opacity: 0.7,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 14,
};
