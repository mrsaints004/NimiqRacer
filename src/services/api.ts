const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || "";

export interface SessionPayload {
  username: string;
  score: number;
  coins: number;
  obstaclesAvoided: number;
  bonusesCollected: number;
  distance: number;
  durationSeconds: number;
  carColor?: string;
  deviceId?: string;
}

export interface SessionResult {
  id: number;
  rank: number;
  isPersonalBest: boolean;
  totalPlayers: number;
  verified: boolean;
}

export interface LeaderboardEntry {
  username: string;
  score: number;
  games: number;
  last_played: string;
  verified: boolean;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<T>;
}

export async function submitSession(payload: SessionPayload): Promise<SessionResult> {
  return postJson<SessionResult>("/api/sessions", payload);
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`);
  if (!res.ok) throw new Error("Request failed");
  const data = await res.json();
  return data.leaderboard as LeaderboardEntry[];
}

export function logEvent(type: string, username?: string, payload?: Record<string, unknown>): void {
  // Fire-and-forget — analytics should never block or break gameplay.
  postJson("/api/events", { type, username, payload }).catch(() => {});
}

export interface StatsSummary {
  totalSessions: number;
  uniquePlayers: number;
  avgScore: number;
  maxScore: number;
  totalCoins: number;
  sessionsToday: number;
  sessionsLast7Days: number;
  gameStarts: number;
  completionRate: number | null;
  eventBreakdown: { type: string; count: number }[];
  topPlayers: { username: string; bestScore: number; games: number; verified: boolean }[];
}

// ── Car purchases ──

export interface Purchase {
  car_hex: string;
  car_name: string;
  tx_hash: string | null;
  price_luna: number;
  created_at: string;
}

export async function fetchPurchases(deviceId: string): Promise<Purchase[]> {
  const res = await fetch(`${API_BASE}/api/purchases/${encodeURIComponent(deviceId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.purchases as Purchase[];
}

export async function recordPurchase(payload: {
  deviceId: string;
  carHex: string;
  carName: string;
  txHash?: string;
  priceLuna: number;
}): Promise<{ ok: boolean; alreadyOwned: boolean }> {
  return postJson("/api/purchases", payload);
}

export async function fetchStatsSummary(adminSecret?: string): Promise<StatsSummary> {
  const headers: Record<string, string> = {};
  if (adminSecret) headers["x-admin-secret"] = adminSecret;
  const res = await fetch(`${API_BASE}/api/stats/summary`, { headers });
  if (res.status === 403) throw new Error("Unauthorized — invalid or missing admin secret");
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<StatsSummary>;
}
