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
}

const POWER_UPS: PowerUpDef[] = [
  { id: "extra_life", name: "Extra Life", description: "Start with 4 lives instead of 3", priceLuna: 20000, color: "#ff4444" },
  { id: "coin_magnet", name: "Coin Magnet", description: "2x coin pickup radius for 30s", priceLuna: 30000, color: "#ffd700" },
  { id: "head_start", name: "Head Start", description: "Begin with 150 bonus points", priceLuna: 10000, color: "#22cc88" },
  { id: "shield", name: "Shield", description: "First crash is free (no life lost)", priceLuna: 50000, color: "#44aaff" },
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
      // Free base cars
      if (!car.premium && idx < 6) return true;
      // Streak cars
      if (car.name === "Streak Racer") return streakCount >= 7;
      if (car.name === "Gold Racer") return streakCount >= 30;
      // Premium purchased
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
        setPurchaseError("Shop unavailable — open in Nimiq Pay");
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
      // Deselect
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
              background: "linear-gradient(135deg, #1a3a5c 0%, #2266cc 50%, #77bbff 100%)",
              color: "white",
              gap: 24,
            }}
          >
            <style>{`
              @keyframes loadPulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
              @keyframes loadBar { 0% { width:5%; } 50% { width:75%; } 100% { width:95%; } }
            `}</style>
            <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: -2 }}>Nimiq Racer</div>
            <div style={{ width: 220, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                borderRadius: 3,
                background: "linear-gradient(90deg, #22cc88, #44ddaa)",
                animation: "loadBar 2s ease-in-out infinite",
              }} />
            </div>
            <div style={{ fontSize: 14, opacity: 0.6, animation: "loadPulse 1.5s ease-in-out infinite" }}>
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

  // Stat bar helper
  const StatBar = ({ label, value, max, color }: { label: string; value: number; max: number; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, marginTop: 2 }}>
      <span style={{ color: "rgba(255,255,255,0.5)", width: 28, textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1a3a5c 0%, #2266cc 50%, #77bbff 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        padding: "20px",
      }}
    >
      <button
        onClick={() => setShowLeaderboard((v) => !v)}
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          zIndex: 50,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 10,
          color: "white",
          fontSize: 14,
          fontWeight: "bold",
          padding: "10px 14px",
          cursor: "pointer",
        }}
      >
        {showLeaderboard ? "\u2190 Back" : "Leaderboard"}
      </button>

      <div
        style={{
          textAlign: "center",
          color: "white",
          maxWidth: "460px",
          padding: "20px",
        }}
      >
        <h1
          style={{
            fontSize: "56px",
            fontWeight: "900",
            marginBottom: "8px",
            letterSpacing: "-2px",
          }}
        >
          Nimiq Racer
        </h1>
        <p
          style={{
            fontSize: "18px",
            marginBottom: "20px",
            opacity: 0.85,
          }}
        >
          Race. Score. Repeat.
        </p>

        {/* Challenge banner */}
        {challengeTarget && (
          <div
            style={{
              background: "rgba(255,170,0,0.2)",
              border: "1px solid rgba(255,170,0,0.5)",
              borderRadius: 12,
              padding: "10px 16px",
              marginBottom: 16,
              fontSize: 14,
              fontWeight: "bold",
              color: "#ffcc44",
            }}
          >
            Challenge: Beat {challengeTarget.creator_username}'s score of {challengeTarget.creator_score} pts!
          </div>
        )}

        {/* Daily Streak Card */}
        {deviceId && !showLeaderboard && (step === "car_select" || step === "power_ups") && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, opacity: 0.7 }}>Daily Streak</div>
              <div style={{ fontSize: 22, fontWeight: "bold" }}>
                {streakCount} day{streakCount !== 1 ? "s" : ""}
              </div>
              {streakCount < 7 && <div style={{ fontSize: 10, opacity: 0.5 }}>7 days = Streak Racer car</div>}
              {streakCount >= 7 && streakCount < 30 && <div style={{ fontSize: 10, opacity: 0.5 }}>30 days = Gold Racer car</div>}
            </div>
            <button
              onClick={handleStreakCheckin}
              disabled={streakCheckedIn || checkingIn || !isReady}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: streakCheckedIn
                  ? "rgba(34,204,136,0.3)"
                  : "linear-gradient(45deg, #22cc88, #44ddaa)",
                color: streakCheckedIn ? "#22cc88" : "#1a1a2e",
                fontSize: 13,
                fontWeight: "bold",
                cursor: streakCheckedIn ? "default" : "pointer",
              }}
            >
              {streakCheckedIn ? "Checked In" : checkingIn ? "Signing..." : "Check In"}
            </button>
          </div>
        )}

        {/* Achievements showcase */}
        {achievements.length > 0 && !showLeaderboard && (step === "car_select" || step === "power_ups") && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: 12,
              padding: "10px 16px",
              marginBottom: 16,
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Achievements</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: info.color,
                      color: "#000",
                      fontSize: 11,
                      fontWeight: "bold",
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
          <div style={{ marginBottom: "20px" }}>
            <Leaderboard limit={10} highlightUsername={username || undefined} />
          </div>
        )}

        {!showLeaderboard && step === "username" && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: "16px",
              padding: "28px",
              marginBottom: "20px",
            }}
          >
            <input
              type="text"
              placeholder="Enter your username"
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
                borderRadius: "10px",
                border: "2px solid rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.1)",
                color: "white",
                fontSize: "16px",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "16px",
              }}
            />

            <button
              onClick={goToCarSelect}
              disabled={!username.trim()}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "10px",
                border: "none",
                background: username.trim()
                  ? "linear-gradient(45deg, #22cc88, #44ddaa)"
                  : "#555",
                color: username.trim() ? "#1a1a2e" : "#999",
                fontSize: "17px",
                fontWeight: "bold",
                cursor: username.trim() ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
                marginBottom: "12px",
              }}
            >
              Next
            </button>
          </div>
        )}

        {!showLeaderboard && step === "car_select" && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: "16px",
              padding: "28px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h3 style={{ fontSize: "22px", fontWeight: "bold", margin: 0 }}>
                Choose Your Ride
              </h3>
              <button
                onClick={() => setStep("username")}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                {username}
              </button>
            </div>

            {purchaseError && (
              <div
                style={{
                  background: "rgba(255,68,68,0.25)",
                  border: "1px solid rgba(255,68,68,0.5)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  marginBottom: "16px",
                  fontSize: "13px",
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
                gap: "12px",
                marginBottom: "24px",
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
                      padding: "12px 6px",
                      borderRadius: "12px",
                      border: isSelected
                        ? "3px solid #22cc88"
                        : "2px solid rgba(255,255,255,0.2)",
                      background: isSelected
                        ? "rgba(34,204,136,0.15)"
                        : "rgba(255,255,255,0.05)",
                      cursor: purchasing || loadingPurchases || (isStreakCar && !available) ? "default" : "pointer",
                      transition: "all 0.2s ease",
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center",
                      gap: "4px",
                      opacity: (purchasing || loadingPurchases) ? 0.6 : (!available ? 0.5 : 1),
                      position: "relative" as const,
                    }}
                  >
                    <div
                      style={{
                        width: "50px",
                        height: "30px",
                        borderRadius: "6px",
                        background: available ? car.hex : `${car.hex}55`,
                        boxShadow: isSelected ? `0 0 16px ${car.hex}88` : "none",
                      }}
                    />
                    <span
                      style={{
                        color: "white",
                        fontSize: "10px",
                        fontWeight: isSelected ? "bold" : "normal",
                        opacity: available ? (isSelected ? 1 : 0.7) : 0.5,
                      }}
                    >
                      {car.name}
                    </span>
                    {/* Stat bars */}
                    {(car.speedBonus > 0 || car.handlingBonus > 0 || car.durabilityBonus > 0) && (
                      <div style={{ width: "100%" }}>
                        {car.speedBonus > 0 && <StatBar label="SPD" value={car.speedBonus} max={0.1} color="#ff4444" />}
                        {car.handlingBonus > 0 && <StatBar label="HND" value={car.handlingBonus} max={2} color="#44aaff" />}
                        {car.durabilityBonus > 0 && <StatBar label="DUR" value={car.durabilityBonus} max={1} color="#22cc88" />}
                      </div>
                    )}
                    {car.premium && available && (
                      <span style={{ fontSize: "9px", color: "#22cc88", fontWeight: "bold" }}>Owned</span>
                    )}
                    {car.premium && !available && (
                      <span style={{ fontSize: "9px", color: "#ffd700", fontWeight: "bold" }}>
                        {formatNim(car.priceLuna)}
                      </span>
                    )}
                    {isStreakCar && !available && (
                      <span style={{ fontSize: "9px", color: "#ff8844", fontWeight: "bold" }}>
                        {streakRequired}-day streak
                      </span>
                    )}
                    {isStreakCar && available && (
                      <span style={{ fontSize: "9px", color: "#22cc88", fontWeight: "bold" }}>Unlocked</span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                if (isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar)) {
                  // Skip power-up step if not in Nimiq Pay
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
                padding: "14px",
                borderRadius: "10px",
                border: "none",
                background: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar)
                  ? "linear-gradient(45deg, #22cc88, #44ddaa)"
                  : "#555",
                color: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar) ? "#1a1a2e" : "#999",
                fontSize: "17px",
                fontWeight: "bold",
                cursor: isCarAvailable(CAR_OPTIONS[selectedCar], selectedCar) ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
                marginBottom: "12px",
              }}
            >
              {isReady && deviceId ? "Next: Power-Ups" : "Start Racing"}
            </button>
          </div>
        )}

        {/* Power-ups selection step */}
        {!showLeaderboard && step === "power_ups" && (
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: "16px",
              padding: "28px",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Power-Ups</h3>
              <button
                onClick={() => setStep("car_select")}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 16, marginTop: 0 }}>
              Buy single-use boosts with NIM. Each lasts one race.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
              {POWER_UPS.map((pu) => {
                const owned = selectedPowerUps.has(pu.id);
                const buying = buyingPowerUp === pu.id;
                return (
                  <button
                    key={pu.id}
                    onClick={() => handlePowerUpBuy(pu)}
                    disabled={buying}
                    style={{
                      padding: "12px 10px",
                      borderRadius: 10,
                      border: owned ? `2px solid ${pu.color}` : "2px solid rgba(255,255,255,0.15)",
                      background: owned ? `${pu.color}22` : "rgba(255,255,255,0.05)",
                      cursor: buying ? "wait" : "pointer",
                      textAlign: "left",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: "bold", color: pu.color, marginBottom: 4 }}>
                      {pu.name}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
                      {pu.description}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: "bold", color: owned ? "#22cc88" : "#ffd700" }}>
                      {owned ? "Selected" : buying ? "Paying..." : formatNim(pu.priceLuna)}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setStep("playing")}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(45deg, #22cc88, #44ddaa)",
                color: "#1a1a2e",
                fontSize: "17px",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "all 0.2s ease",
                marginBottom: "12px",
              }}
            >
              {selectedPowerUps.size > 0
                ? `Start Racing (${selectedPowerUps.size} power-up${selectedPowerUps.size > 1 ? "s" : ""})`
                : "Start Racing (no power-ups)"}
            </button>
          </div>
        )}

        <p style={{ fontSize: "13px", opacity: 0.5 }}>
          Desktop: Arrow keys to steer. Mobile: Swipe or tilt your phone to steer.
          <br />
          Avoid obstacles. Collect coins. You have 3 lives per run!
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
