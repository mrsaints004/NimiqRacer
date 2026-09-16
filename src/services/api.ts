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

// ── Power-ups ──

export interface PowerUpPurchase {
  id: number;
  power_up: string;
  used: number;
  created_at: string;
}

export async function recordPowerUp(payload: {
  deviceId: string;
  powerUp: string;
  txHash?: string;
  priceLuna: number;
}): Promise<{ ok: boolean; id: number }> {
  return postJson("/api/power-ups", payload);
}

export async function fetchPowerUps(deviceId: string): Promise<PowerUpPurchase[]> {
  const res = await fetch(`${API_BASE}/api/power-ups/${encodeURIComponent(deviceId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.powerUps as PowerUpPurchase[];
}

// ── Challenges ──

export interface Challenge {
  id: string;
  creator_username: string;
  creator_score: number;
  status: string;
  accepted_by: string | null;
  accepted_score: number | null;
}

export async function createChallenge(payload: {
  username: string;
  score: number;
  deviceId?: string;
}): Promise<{ id: string }> {
  return postJson("/api/challenges", payload);
}

export async function fetchChallenge(id: string): Promise<Challenge | null> {
  const res = await fetch(`${API_BASE}/api/challenges/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.challenge as Challenge;
}

export async function acceptChallenge(id: string, payload: {
  username: string;
  score: number;
}): Promise<{ ok: boolean }> {
  return postJson(`/api/challenges/${encodeURIComponent(id)}/accept`, payload);
}

// ── Streaks ──

export interface StreakInfo {
  current_streak: number;
  last_date: string | null;
  total_checkins: number;
}

export async function streakCheckin(payload: {
  deviceId: string;
  publicKey: string;
  signature: string;
  message: string;
}): Promise<{ ok: boolean; streak: number; unlocks: string[] }> {
  return postJson("/api/streaks/checkin", payload);
}

export async function fetchStreak(deviceId: string): Promise<StreakInfo> {
  const res = await fetch(`${API_BASE}/api/streaks/${encodeURIComponent(deviceId)}`);
  if (!res.ok) return { current_streak: 0, last_date: null, total_checkins: 0 };
  const data = await res.json();
  return data as StreakInfo;
}

// ── Achievements ──

export interface Achievement {
  badge: string;
  created_at: string;
}

export async function fetchAchievements(deviceId: string): Promise<Achievement[]> {
  const res = await fetch(`${API_BASE}/api/achievements/${encodeURIComponent(deviceId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.achievements as Achievement[];
}

// ── Session result extended ──

export interface SessionResultExtended extends SessionResult {
  newBadges?: string[];
}

export async function fetchStatsSummary(adminSecret?: string): Promise<StatsSummary> {
  const headers: Record<string, string> = {};
  if (adminSecret) headers["x-admin-secret"] = adminSecret;
  const res = await fetch(`${API_BASE}/api/stats/summary`, { headers });
  if (res.status === 403) throw new Error("Unauthorized — invalid or missing admin secret");
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<StatsSummary>;
}
