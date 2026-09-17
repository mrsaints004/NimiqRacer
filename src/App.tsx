import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Leaderboard from "./components/Leaderboard";
import Dashboard from "./components/Dashboard";
import { NimiqProvider, useNimiq, sendNimPayment, signMessage } from "./nimiq";
import {
  fetchPurchases,
  recordPurchase,
  recordPowerUp,
  fetchChallenge,
  fetchStreak,
  streakCheckin,
  fetchAchievements,
  type Challenge,
  type Achievement,
} from "./services/api";

const EnhancedCarRaceGame = lazy(() => import("./components/EnhancedCarRaceGame"));

// Must match the SAFE_NAME_RE regex in server/src/validate.js
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

const NIM_RECIPIENT = (import.meta.env.VITE_NIM_RECIPIENT_ADDRESS as string | undefined) || "";
const CAR_PRICE_LUNA = parseInt(import.meta.env.VITE_CAR_PRICE_LUNA as string || "100000", 10);

function formatNim(luna: number): string {
  const nim = luna / 100000;
  return nim >= 1 ? `${nim} NIM` : `${luna} Luna`;
}

// ── Username persistence ──
const USERNAME_KEY = "nimiq_racer_username";

function loadSavedUsername(): string {
  try { return localStorage.getItem(USERNAME_KEY) || ""; } catch { return ""; }
}

function saveUsername(name: string) {
  try { localStorage.setItem(USERNAME_KEY, name); } catch { /* */ }
}

// ── Global CSS animations ──
const GLOBAL_STYLES = `
  @keyframes titleGlow {
    0%, 100% { text-shadow: 0 0 20px rgba(34,204,136,0.3), 0 0 60px rgba(34,204,136,0.1); }
    50% { text-shadow: 0 0 30px rgba(34,204,136,0.5), 0 0 80px rgba(34,204,136,0.2); }
  }
  @keyframes subtitleSlide {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 0.85; transform: translateY(0); }
  }
  @keyframes cardFadeIn {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes roadLine {
    from { transform: translateY(-20px); }
    to { transform: translateY(20px); }
  }
  @keyframes loadPulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
  @keyframes loadBar { 0% { width:5%; } 50% { width:75%; } 100% { width:95%; } }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  @keyframes streakPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34,204,136,0.4); }
    50% { box-shadow: 0 0 0 6px rgba(34,204,136,0); }
  }
`;

// ── Car options with performance tiers ──

interface CarOption {
  color: number;
  name: string;
  hex: string;
  premium: boolean;
  priceLuna: number;
  speedBonus: number;
  handlingBonus: number;
  durabilityBonus: number;
}

const CAR_OPTIONS: CarOption[] = [
  { color: 0x3388ff, name: "Blue Bolt", hex: "#3388ff", premium: false, priceLuna: 0, speedBonus: 0, handlingBonus: 0, durabilityBonus: 0 },
  { color: 0xff4444, name: "Red Fury", hex: "#ff4444", premium: false, priceLuna: 0, speedBonus: 0, handlingBonus: 0, durabilityBonus: 0 },
  { color: 0x44cc44, name: "Green Machine", hex: "#44cc44", premium: false, priceLuna: 0, speedBonus: 0, handlingBonus: 0, durabilityBonus: 0 },
  { color: 0xff8800, name: "Orange Blaze", hex: "#ff8800", premium: true, priceLuna: CAR_PRICE_LUNA, speedBonus: 0.05, handlingBonus: 1, durabilityBonus: 0 },
  { color: 0xcc44cc, name: "Purple Storm", hex: "#cc44cc", premium: true, priceLuna: CAR_PRICE_LUNA, speedBonus: 0.03, handlingBonus: 0, durabilityBonus: 1 },
  { color: 0x00cccc, name: "Cyan Surge", hex: "#00cccc", premium: true, priceLuna: 200000, speedBonus: 0.08, handlingBonus: 2, durabilityBonus: 0 },
  // Streak-exclusive cars
  { color: 0xffaa00, name: "Streak Racer", hex: "#ffaa00", premium: false, priceLuna: 0, speedBonus: 0.04, handlingBonus: 1, durabilityBonus: 0 },
  { color: 0xffd700, name: "Gold Racer", hex: "#ffd700", premium: false, priceLuna: 0, speedBonus: 0.06, handlingBonus: 1, durabilityBonus: 1 },
];

// ── Power-up definitions ──

interface PowerUpDef {
  id: string;
  name: string;
  description: string;
  priceLuna: number;
  color: string;
  icon: string;
}

const POWER_UPS: PowerUpDef[] = [
  { id: "extra_life", name: "Extra Life", description: "Start with 4 lives instead of 3", priceLuna: 20000, color: "#ff4444", icon: "\u2764" },
  { id: "coin_magnet", name: "Coin Magnet", description: "2x coin pickup radius for 30s", priceLuna: 30000, color: "#ffd700", icon: "\u25C9" },
  { id: "head_start", name: "Head Start", description: "Begin with 150 bonus points", priceLuna: 10000, color: "#22cc88", icon: "\u25B6" },
  { id: "shield", name: "Shield", description: "First crash is free (no life lost)", priceLuna: 50000, color: "#44aaff", icon: "\u25C6" },
];

// ── Achievement badge info ──

const BADGE_INFO: Record<string, { name: string; icon: string; color: string }> = {
  rookie: { name: "Rookie", icon: "R", color: "#88cc88" },
  road_warrior: { name: "Road Warrior", icon: "W", color: "#ff8844" },
  speed_demon: { name: "Speed Demon", icon: "S", color: "#ff4444" },
  coin_hunter: { name: "Coin Hunter", icon: "C", color: "#ffd700" },
  dodger: { name: "Dodger", icon: "D", color: "#44aaff" },
  veteran: { name: "Veteran", icon: "V", color: "#cc44cc" },
  endurance: { name: "Endurance", icon: "E", color: "#22cc88" },
};

// ── Decorative road lines background ──
function RoadLines() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
      overflow: "hidden", pointerEvents: "none", zIndex: 0,
    }}>
      {/* Center dashed road line */}
      <div style={{
        position: "absolute", left: "50%", top: 0, width: 3, height: "100%",
        opacity: 0.06,
      }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            width: 3, height: 30, background: "white", borderRadius: 2,
            marginBottom: 20, animation: "roadLine 1.5s linear infinite",
          }} />
        ))}
      </div>
      {/* Side lane marks */}
      {[-120, 120].map((offset) => (
        <div key={offset} style={{
          position: "absolute", left: `calc(50% + ${offset}px)`, top: 0,
          width: 2, height: "100%", background: "rgba(255,255,255,0.03)",
        }} />
      ))}
    </div>
  );
}

function GameWrapper() {
  const { isReady, deviceId } = useNimiq();
  const [username, setUsername] = useState(loadSavedUsername);
  const [step, setStep] = useState<"username" | "car_select" | "power_ups" | "playing">(
    () => (loadSavedUsername() ? "car_select" : "username")
  );
  const [selectedCar, setSelectedCar] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [ownedCarHexes, setOwnedCarHexes] = useState<Set<string>>(new Set());
  const [purchasing, setPurchasing] = useState(false);
  const purchasingRef = useRef(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [loadingPurchases, setLoadingPurchases] = useState(false);

  // Power-ups
  const [selectedPowerUps, setSelectedPowerUps] = useState<Set<string>>(new Set());
  const [buyingPowerUp, setBuyingPowerUp] = useState<string | null>(null);

  // Challenges
  const [challengeTarget, setChallengeTarget] = useState<Challenge | null>(null);

  // Streaks
  const [streakCount, setStreakCount] = useState(0);
  const [streakCheckedIn, setStreakCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  // Achievements
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  // Load owned cars from database when deviceId is available
  useEffect(() => {
    if (!deviceId) return;
    setLoadingPurchases(true);
    fetchPurchases(deviceId)
      .then((purchases) => {
        setOwnedCarHexes(new Set(purchases.map((p) => p.car_hex)));
      })
      .catch(() => {})
      .finally(() => setLoadingPurchases(false));
  }, [deviceId]);

  // Load streak info
  useEffect(() => {
    if (!deviceId) return;
    fetchStreak(deviceId).then((info) => {
      setStreakCount(info.current_streak);
      const today = new Date().toISOString().slice(0, 10);
      setStreakCheckedIn(info.last_date === today);
    }).catch(() => {});
  }, [deviceId]);

  // Load achievements
  useEffect(() => {
    if (!deviceId) return;
    fetchAchievements(deviceId).then(setAchievements).catch(() => {});
  }, [deviceId]);

  // Parse challenge from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const challengeId = params.get("challenge");
    if (challengeId) {
      fetchChallenge(challengeId).then((c) => {
        if (c && c.status === "open") setChallengeTarget(c);
      }).catch(() => {});
    }
  }, []);

  const isCarAvailable = useCallback(
    (car: CarOption, idx: number) => {
      if (!car.premium && idx < 6) return true;
      if (car.name === "Streak Racer") return streakCount >= 7;
      if (car.name === "Gold Racer") return streakCount >= 30;
      return ownedCarHexes.has(car.hex);
    },
    [ownedCarHexes, streakCount]
  );

  const goToCarSelect = useCallback(() => {
    if (username.trim()) {
      saveUsername(username.trim());
      setStep("car_select");
    }
  }, [username]);

  const handleCarClick = useCallback(
    async (index: number) => {
      const car = CAR_OPTIONS[index];

      if (isCarAvailable(car, index)) {
        setSelectedCar(index);
        return;
      }

      if (!deviceId) {
        setPurchaseError("Open in Nimiq Pay to purchase cars");
        setTimeout(() => setPurchaseError(null), 3000);
        return;
      }

      if (!isReady || !NIM_RECIPIENT) {
        setPurchaseError("Shop unavailable \u2014 open in Nimiq Pay");
        setTimeout(() => setPurchaseError(null), 3000);
        return;
      }

      if (purchasingRef.current) return;
      purchasingRef.current = true;
      setPurchasing(true);
      setPurchaseError(null);

      try {
        const result = await sendNimPayment({
          recipient: NIM_RECIPIENT,
          value: car.priceLuna,
          data: `NimiqRacer:${car.name}`,
        });

        if (result.success) {
          await recordPurchase({
            deviceId,
            carHex: car.hex,
            carName: car.name,
            txHash: result.txHash,
            priceLuna: car.priceLuna,
          }).catch(() => {});

          const purchases = await fetchPurchases(deviceId).catch(() => []);
          setOwnedCarHexes(new Set(purchases.map((p) => p.car_hex)));
          setSelectedCar(index);
        } else {
          setPurchaseError(result.error || "Purchase failed");
          setTimeout(() => setPurchaseError(null), 3000);
        }
      } finally {
        purchasingRef.current = false;
        setPurchasing(false);
      }
    },
    [isReady, deviceId, isCarAvailable]
  );

  // ── Power-up purchase ──
  const handlePowerUpBuy = useCallback(async (powerUp: PowerUpDef) => {
    if (!deviceId || !isReady || !NIM_RECIPIENT) return;
    if (selectedPowerUps.has(powerUp.id)) {
      setSelectedPowerUps((prev) => {
        const next = new Set(prev);
        next.delete(powerUp.id);
        return next;
      });
      return;
    }

    setBuyingPowerUp(powerUp.id);
    try {
      const result = await sendNimPayment({
        recipient: NIM_RECIPIENT,
        value: powerUp.priceLuna,
        data: `NimiqRacer:PowerUp:${powerUp.id}`,
      });

      if (result.success) {
        await recordPowerUp({
          deviceId,
          powerUp: powerUp.id,
          txHash: result.txHash,
          priceLuna: powerUp.priceLuna,
        }).catch(() => {});

        setSelectedPowerUps((prev) => new Set(prev).add(powerUp.id));
      }
    } finally {
      setBuyingPowerUp(null);
    }
  }, [deviceId, isReady, selectedPowerUps]);

  // ── Streak check-in ──
  const handleStreakCheckin = useCallback(async () => {
    if (!deviceId || checkingIn || streakCheckedIn) return;
    setCheckingIn(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const message = `NimiqRacer:checkin:${today}:${deviceId}`;
      const sigResult = await signMessage(message);
      if (!sigResult) {
        setCheckingIn(false);
        return;
      }

      const resp = await streakCheckin({
        deviceId,
        publicKey: sigResult.publicKey,
        signature: sigResult.signature,
        message,
      });

      setStreakCount(resp.streak);
      setStreakCheckedIn(true);
    } catch {
      // ignore
    } finally {
      setCheckingIn(false);
    }
  }, [deviceId, checkingIn, streakCheckedIn]);

  const carStats = CAR_OPTIONS[selectedCar];

  // ── Playing state ──
  if (step === "playing") {
    return (
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #0d1b2a 0%, #1b2d4a 30%, #1a3a5c 60%, #2266cc 100%)",
              color: "white",
              gap: 24,
            }}
          >
            <style>{GLOBAL_STYLES}</style>
            <div style={{
              fontSize: 42, fontWeight: 900, letterSpacing: -2,
              animation: "titleGlow 2s ease-in-out infinite",
            }}>
              Nimiq Racer
            </div>
            <div style={{ width: 220, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: "linear-gradient(90deg, #22cc88, #44ddaa, #22cc88)",
                backgroundSize: "200% 100%",
                animation: "loadBar 2s ease-in-out infinite, shimmer 1.5s linear infinite",
              }} />
            </div>
            <div style={{ fontSize: 14, opacity: 0.5, animation: "loadPulse 1.5s ease-in-out infinite" }}>
              Preparing the track...
            </div>
          </div>
        }
      >
        <EnhancedCarRaceGame
          username={username}
          selectedCarColor={CAR_OPTIONS[selectedCar].color}
          onHome={() => {
            setStep("car_select");
            setSelectedPowerUps(new Set());
          }}
          activePowerUps={selectedPowerUps}
          carStats={{
            speedBonus: carStats.speedBonus,
            handlingBonus: carStats.handlingBonus,
            durabilityBonus: carStats.durabilityBonus,
          }}
          challengeTarget={challengeTarget ? {
            username: challengeTarget.creator_username,
            score: challengeTarget.creator_score,
            challengeId: challengeTarget.id,
          } : undefined}
        />
      </Suspense>
    );
  }

  // ── Stat bar helper ──
  const StatBar = ({ label, value, max, color }: { label: string; value: number; max: number; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, marginTop: 2 }}>
      <span style={{ color: "rgba(255,255,255,0.5)", width: 28, textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );

  // ── Landing / Menu UI ──
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0d1b2a 0%, #1b2d4a 30%, #1a3a5c 60%, #2266cc 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        padding: "20px",
        overflow: "hidden",
      }}
    >
      <style>{GLOBAL_STYLES}</style>
      <RoadLines />

      {/* Top bar */}
      <div style={{
        position: "absolute", top: 16, left: 16, right: 16, zIndex: 50,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <button
          onClick={() => setShowLeaderboard((v) => !v)}
          style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 10,
            color: "white",
            fontSize: 13,
            fontWeight: "bold",
            padding: "8px 14px",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {showLeaderboard ? "\u2190 Back" : "\u{1F3C6} Leaderboard"}
        </button>
        {step !== "username" && (
          <div style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 10,
            padding: "6px 12px",
            color: "rgba(255,255,255,0.7)",
            fontSize: 12,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}>
            {username}
          </div>
        )}
      </div>

      <div
        style={{
          textAlign: "center",
          color: "white",
          maxWidth: "480px",
          width: "100%",
          padding: "20px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Title section */}
        <div style={{ marginBottom: 24, animation: "cardFadeIn 0.6s ease-out" }}>
          {/* Decorative car icon */}
          <div style={{
            fontSize: 36, marginBottom: 8,
            animation: "float 3s ease-in-out infinite",
            filter: "drop-shadow(0 4px 12px rgba(34,204,136,0.3))",
          }}>
            {"\u{1F3CE}\uFE0F"}
          </div>
          <h1
            style={{
              fontSize: "clamp(36px, 10vw, 56px)",
              fontWeight: "900",
              marginBottom: "4px",
              marginTop: 0,
              letterSpacing: "-2px",
              animation: "titleGlow 3s ease-in-out infinite",
              background: "linear-gradient(135deg, #ffffff 0%, #22cc88 50%, #ffffff 100%)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Nimiq Racer
          </h1>
          <p
            style={{
              fontSize: "16px",
              margin: 0,
              opacity: 0.85,
              animation: "subtitleSlide 0.8s ease-out",
              letterSpacing: "3px",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Race. Score. Repeat.
          </p>
        </div>

        {/* Challenge banner */}
        {challengeTarget && (
          <div
            style={{
              background: "linear-gradient(135deg, rgba(255,170,0,0.2), rgba(255,100,0,0.15))",
              border: "1px solid rgba(255,170,0,0.4)",
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: 16,
              fontSize: 15,
              fontWeight: "bold",
              color: "#ffcc44",
              animation: "cardFadeIn 0.5s ease-out",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            {"\u{1F3AF}"} Beat {challengeTarget.creator_username}'s score of {challengeTarget.creator_score} pts!
          </div>
        )}

        {/* Daily Streak Card */}
        {deviceId && !showLeaderboard && (step === "car_select" || step === "power_ups") && (
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              animation: "cardFadeIn 0.5s ease-out 0.1s both",
              border: "1px solid rgba(34,204,136,0.15)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Daily Streak</div>
              <div style={{ fontSize: 24, fontWeight: "bold", lineHeight: 1 }}>
                {streakCount}
                <span style={{ fontSize: 13, opacity: 0.6, marginLeft: 4 }}>day{streakCount !== 1 ? "s" : ""}</span>
              </div>
              {streakCount < 7 && <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>7 days = Streak Racer car</div>}
              {streakCount >= 7 && streakCount < 30 && <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>30 days = Gold Racer car</div>}
            </div>
            <button
              onClick={handleStreakCheckin}
              disabled={streakCheckedIn || checkingIn || !isReady}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: streakCheckedIn
                  ? "rgba(34,204,136,0.2)"
                  : "linear-gradient(135deg, #22cc88, #44ddaa)",
                color: streakCheckedIn ? "#22cc88" : "#0d1b2a",
                fontSize: 13,
                fontWeight: "bold",
                cursor: streakCheckedIn ? "default" : "pointer",
                animation: !streakCheckedIn && !checkingIn ? "streakPulse 2s ease-in-out infinite" : "none",
                transition: "all 0.2s",
              }}
            >
              {streakCheckedIn ? "\u2713 Done" : checkingIn ? "Signing..." : "Check In"}
            </button>
          </div>
        )}

        {/* Achievements showcase */}
        {achievements.length > 0 && !showLeaderboard && (step === "car_select" || step === "power_ups") && (
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 14,
              padding: "12px 18px",
              marginBottom: 14,
              textAlign: "left",
              animation: "cardFadeIn 0.5s ease-out 0.2s both",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Achievements</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {achievements.map((a) => {
                const info = BADGE_INFO[a.badge];
                if (!info) return null;
                return (
                  <span
                    key={a.badge}
                    title={info.name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: `linear-gradient(135deg, ${info.color}, ${info.color}cc)`,
                      color: "#000",
                      fontSize: 11,
                      fontWeight: "bold",
                      boxShadow: `0 2px 8px ${info.color}44`,
                    }}
                  >
                    {info.icon}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {showLeaderboard && (
          <div style={{ marginBottom: 20, animation: "cardFadeIn 0.4s ease-out" }}>
            <Leaderboard limit={100} highlightUsername={username || undefined} />
          </div>
        )}

        {/* ── Username step ── */}
        {!showLeaderboard && step === "username" && (
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 18,
              padding: "32px 28px",
              marginBottom: 20,
              animation: "cardFadeIn 0.5s ease-out",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>
              Enter your racer name
            </div>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || USERNAME_RE.test(v)) setUsername(v);
              }}
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter" && username.trim()) goToCarSelect();
              }}
              style={{
                width: "100%",
                padding: "14px 18px",
                borderRadius: 12,
                border: "2px solid rgba(34,204,136,0.3)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                fontSize: 18,
                fontWeight: "bold",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 16,
                textAlign: "center",
                letterSpacing: 1,
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = "rgba(34,204,136,0.6)"}
              onBlur={(e) => e.currentTarget.style.borderColor = "rgba(34,204,136,0.3)"}
            />

            <button
              onClick={goToCarSelect}
              disabled={!username.trim()}
              style={{
                width: "100%",
                padding: 15,
                borderRadius: 12,
                border: "none",
                background: username.trim()
                  ? "linear-gradient(135deg, #22cc88, #44ddaa)"
                  : "rgba(255,255,255,0.1)",
                color: username.trim() ? "#0d1b2a" : "rgba(255,255,255,0.3)",
                fontSize: 17,
                fontWeight: "bold",
                cursor: username.trim() ? "pointer" : "not-allowed",
                transition: "all 0.3s ease",
                letterSpacing: 0.5,
              }}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Car select step ── */}
        {!showLeaderboard && step === "car_select" && (
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 18,
              padding: "24px 22px",
              marginBottom: 20,
              animation: "cardFadeIn 0.5s ease-out",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ fontSize: 18, fontWeight: "bold", margin: 0, letterSpacing: 0.5 }}>
                Choose Your Ride
              </h3>
              <button
                onClick={() => setStep("username")}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                Change Name
              </button>
            </div>

            {purchaseError && (
              <div
                style={{
                  background: "rgba(255,68,68,0.15)",
                  border: "1px solid rgba(255,68,68,0.3)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 14,
                  fontSize: 13,
                  color: "#ff8888",
                }}
              >
                {purchaseError}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 20,
              }}
            >
              {CAR_OPTIONS.map((car, i) => {
                const available = isCarAvailable(car, i);
                const isSelected = selectedCar === i;
                const isStreakCar = car.name === "Streak Racer" || car.name === "Gold Racer";
                const streakRequired = car.name === "Streak Racer" ? 7 : car.name === "Gold Racer" ? 30 : 0;
                return (
                  <button
                    key={i}
                    onClick={() => available ? setSelectedCar(i) : handleCarClick(i)}
                    disabled={purchasing || loadingPurchases || (isStreakCar && !available)}
                    style={{
                      padding: "10px 4px 8px",
                      borderRadius: 12,
                      border: isSelected
                        ? "2px solid #22cc88"
                        : "1px solid rgba(255,255,255,0.1)",
                      background: isSelected
                        ? "rgba(34,204,136,0.12)"
                        : "rgba(255,255,255,0.03)",
                      cursor: purchasing || loadingPurchases || (isStreakCar && !available) ? "default" : "pointer",
                      transition: "all 0.2s ease",
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center",
                      gap: 3,
                      opacity: (purchasing || loadingPurchases) ? 0.5 : (!available ? 0.4 : 1),
                      position: "relative" as const,
                      boxShadow: isSelected ? `0 0 20px ${car.hex}33` : "none",
                    }}
                  >
                    {/* Car color swatch */}
                    <div
                      style={{
                        width: 48,
                        height: 28,
                        borderRadius: 6,
                        background: available
                          ? `linear-gradient(135deg, ${car.hex}, ${car.hex}cc)`
                          : `${car.hex}44`,
                        boxShadow: isSelected ? `0 4px 12px ${car.hex}55` : "none",
                        transition: "all 0.2s",
                      }}
                    />
                    <span
                      style={{
                        color: "white",
                        fontSize: 9,
                        fontWeight: isSelected ? "bold" : 500,
                        opacity: available ? 0.8 : 0.5,
                      }}
                    >
                      {car.name}
                    </span>
                    {/* Stat bars */}
                    {(car.speedBonus > 0 || car.handlingBonus > 0 || car.durabilityBonus > 0) && (
                      <div style={{ width: "100%", padding: "0 2px" }}>
                        {car.speedBonus > 0 && <StatBar label="SPD" value={car.speedBonus} max={0.1} color="#ff4444" />}
                        {car.handlingBonus > 0 && <StatBar label="HND" value={car.handlingBonus} max={2} color="#44aaff" />}
                        {car.durabilityBonus > 0 && <StatBar label="DUR" value={car.durabilityBonus} max={1} color="#22cc88" />}
                      </div>
                    )}
                    {car.premium && available && (
                      <span style={{ fontSize: 8, color: "#22cc88", fontWeight: "bold" }}>OWNED</span>
                    )}
                    {car.premium && !available && (
                      <span style={{ fontSize: 8, color: "#ffd700", fontWeight: "bold" }}>
                        {formatNim(car.priceLuna)}
                      </span>
                    )}
                    {isStreakCar && !available && (
                      <span style={{ fontSize: 8, color: "#ff8844", fontWeight: "bold" }}>
                        {streakRequired}-day streak
                      </span>
                    )}
                    {isStreakCar && available && (
                      <span style={{ fontSize: 8, color: "#22cc88", fontWeight: "bold" }}>UNLOCKED</span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                if (isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar)) {
                  if (isReady && deviceId) {
                    setStep("power_ups");
                  } else {
                    setStep("playing");
                  }
                }
              }}
              disabled={!isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar)}
              style={{
                width: "100%",
                padding: 15,
                borderRadius: 12,
                border: "none",
                background: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar)
                  ? "linear-gradient(135deg, #22cc88, #44ddaa)"
                  : "rgba(255,255,255,0.1)",
                color: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar) ? "#0d1b2a" : "rgba(255,255,255,0.3)",
                fontSize: 17,
                fontWeight: "bold",
                cursor: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar) ? "pointer" : "not-allowed",
                transition: "all 0.3s ease",
              }}
            >
              {isReady && deviceId ? "Next: Power-Ups \u2192" : "Start Racing \u2192"}
            </button>
          </div>
        )}

        {/* ── Power-ups step ── */}
        {!showLeaderboard && step === "power_ups" && (
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 18,
              padding: "24px 22px",
              marginBottom: 20,
              animation: "cardFadeIn 0.5s ease-out",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>Power-Ups</h3>
              <button
                onClick={() => setStep("car_select")}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                \u2190 Back
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.4, marginBottom: 14, marginTop: 4 }}>
              Buy single-use boosts with NIM. Each lasts one race.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
              {POWER_UPS.map((pu) => {
                const owned = selectedPowerUps.has(pu.id);
                const buying = buyingPowerUp === pu.id;
                return (
                  <button
                    key={pu.id}
                    onClick={() => handlePowerUpBuy(pu)}
                    disabled={buying}
                    style={{
                      padding: "14px 12px",
                      borderRadius: 12,
                      border: owned ? `2px solid ${pu.color}` : "1px solid rgba(255,255,255,0.1)",
                      background: owned ? `${pu.color}15` : "rgba(255,255,255,0.03)",
                      cursor: buying ? "wait" : "pointer",
                      textAlign: "left",
                      transition: "all 0.2s",
                      boxShadow: owned ? `0 0 16px ${pu.color}22` : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{pu.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: "bold", color: pu.color }}>{pu.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6, lineHeight: 1.3 }}>
                      {pu.description}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: "bold", color: owned ? "#22cc88" : "#ffd700" }}>
                      {owned ? "\u2713 Selected" : buying ? "Paying..." : formatNim(pu.priceLuna)}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setStep("playing")}
              style={{
                width: "100%",
                padding: 15,
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #22cc88, #44ddaa)",
                color: "#0d1b2a",
                fontSize: 17,
                fontWeight: "bold",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
            >
              {selectedPowerUps.size > 0
                ? `Start Racing (${selectedPowerUps.size} boost${selectedPowerUps.size > 1 ? "s" : ""}) \u2192`
                : "Start Racing \u2192"}
            </button>
          </div>
        )}

        {/* Controls hint */}
        <p style={{ fontSize: 12, opacity: 0.35, marginTop: 8, lineHeight: 1.6 }}>
          {"ontouchstart" in window
            ? "Swipe or tilt to steer \u00b7 Collect coins \u00b7 3 lives per run"
            : "Arrow keys to steer \u00b7 Collect coins \u00b7 3 lives per run"}
        </p>
      </div>
    </div>
  );
}

function App() {
  if (window.location.pathname === "/dashboard") {
    return <Dashboard />;
  }

  return (
    <ErrorBoundary>
      <NimiqProvider>
        <GameWrapper />
      </NimiqProvider>
    </ErrorBoundary>
  );
}

export default App;
