import React, { useCallback, useEffect, useState } from "react";
import { fetchLeaderboard, type LeaderboardEntry } from "../services/api";

interface LeaderboardProps {
  limit?: number;
  highlightUsername?: string;
  title?: string;
  compact?: boolean;
}

const RANK_MEDALS: Record<number, string> = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

const Leaderboard: React.FC<LeaderboardProps> = ({
  limit = 100,
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
          {title}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!compact && entries && entries.length > 0 && (
            <span style={{ fontSize: 12, opacity: 0.5 }}>
              {entries.length} {entries.length === 1 ? "player" : "players"}
            </span>
          )}
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
            {loading ? "\u2026" : "Refresh"}
          </button>
        </div>
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
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: compact ? undefined : "60vh",
            overflowY: compact ? undefined : "auto",
            WebkitOverflowScrolling: "touch" as const,
          }}
        >
          {entries.map((entry, i) => {
            const isMe = highlightUsername && entry.username === highlightUsername;
            const rank = i + 1;
            const medal = RANK_MEDALS[rank];
            const isTop3 = rank <= 3;
            return (
              <li
                key={entry.username}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: compact ? "6px 8px" : "8px 10px",
                  borderRadius: 8,
                  background: isMe
                    ? "rgba(34,204,136,0.18)"
                    : isTop3 && !compact
                      ? "rgba(255,215,0,0.06)"
                      : "transparent",
                  fontSize: compact ? 13 : 14,
                  marginBottom: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    opacity: medal ? 1 : 0.5,
                    width: 22,
                    display: "inline-block",
                    fontSize: medal ? 16 : undefined,
                    textAlign: "center",
                  }}>
                    {medal || rank}
                  </span>
                  <span style={{ fontWeight: isMe || isTop3 ? "bold" : "normal" }}>
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
                <span style={{ fontWeight: "bold", color: isTop3 ? "#ffd700" : "#ccc" }}>
                  {entry.score.toLocaleString()}{" "}
                  <span style={{ opacity: 0.5, fontWeight: "normal", fontSize: compact ? 11 : 12 }}>pts</span>
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
