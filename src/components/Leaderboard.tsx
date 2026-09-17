import React, { useCallback, useEffect, useState } from "react";
import { fetchLeaderboard, type LeaderboardEntry } from "../services/api";

interface LeaderboardProps {
  limit?: number;
  highlightUsername?: string;
  title?: string;
  compact?: boolean;
}

const Leaderboard: React.FC<LeaderboardProps> = ({
  limit = 10,
  highlightUsername,
  title = "Leaderboard",
  compact = false,
}) => {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchLeaderboard(limit)
      .then((rows) => setEntries(rows))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.25)",
        borderRadius: compact ? 12 : 16,
        padding: compact ? "16px" : "24px",
        color: "white",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontSize: compact ? 15 : 18,
            fontWeight: "bold",
            margin: 0,
          }}
        >
          🏆 {title}
        </h3>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.7)",
            fontSize: 12,
            padding: "4px 10px",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
          Couldn't reach the leaderboard server.
        </p>
      )}

      {!error && entries && entries.length === 0 && (
        <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
          No runs yet — be the first on the board!
        </p>
      )}

      {!error && entries && entries.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((entry, i) => {
            const isMe = highlightUsername && entry.username === highlightUsername;
            return (
              <li
                key={entry.username}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: compact ? "6px 8px" : "8px 10px",
                  borderRadius: 8,
                  background: isMe ? "rgba(34,204,136,0.18)" : "transparent",
                  fontSize: compact ? 13 : 14,
                  marginBottom: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ opacity: 0.5, width: 18, display: "inline-block" }}>
                    {i + 1}
                  </span>
                  <span style={{ fontWeight: isMe ? "bold" : "normal" }}>
                    {entry.username}
                  </span>
                  {entry.verified && (
                    <span title="Verified device" style={{ fontSize: 11, color: "#22cc88" }}>
                      &#10003;
                    </span>
                  )}
                  {entry.badge_count > 0 && (
                    <span
                      title={`${entry.badge_count} badges`}
                      style={{
                        fontSize: 9,
                        fontWeight: "bold",
                        background: "#ffd700",
                        color: "#000",
                        borderRadius: "50%",
                        width: 16,
                        height: 16,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {entry.badge_count}
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: "bold", color: "#ffd700" }}>
                  {entry.score} <span style={{ opacity: 0.5, fontWeight: "normal" }}>pts</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default Leaderboard;
