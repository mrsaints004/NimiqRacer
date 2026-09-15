import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Leaderboard from "./components/Leaderboard";
import Dashboard from "./components/Dashboard";
import { NimiqProvider, useNimiq, sendNimPayment } from "./nimiq";
import { fetchPurchases, recordPurchase } from "./services/api";

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

interface CarOption {
  color: number;
  name: string;
  hex: string;
  premium: boolean;
}

const CAR_OPTIONS: CarOption[] = [
  { color: 0x3388ff, name: "Blue Bolt", hex: "#3388ff", premium: false },
  { color: 0xff4444, name: "Red Fury", hex: "#ff4444", premium: false },
  { color: 0x44cc44, name: "Green Machine", hex: "#44cc44", premium: false },
  { color: 0xff8800, name: "Orange Blaze", hex: "#ff8800", premium: true },
  { color: 0xcc44cc, name: "Purple Storm", hex: "#cc44cc", premium: true },
  { color: 0x00cccc, name: "Cyan Surge", hex: "#00cccc", premium: true },
];

function GameWrapper() {
  const { isReady, deviceId } = useNimiq();
  const [username, setUsername] = useState(loadSavedUsername);
  const [step, setStep] = useState<"username" | "car_select" | "playing">(
    () => (loadSavedUsername() ? "car_select" : "username")
  );
  const [selectedCar, setSelectedCar] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [ownedCarHexes, setOwnedCarHexes] = useState<Set<string>>(new Set());
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [loadingPurchases, setLoadingPurchases] = useState(false);

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

  const isCarAvailable = useCallback(
    (car: CarOption) => !car.premium || ownedCarHexes.has(car.hex),
    [ownedCarHexes]
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

      if (isCarAvailable(car)) {
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

      setPurchasing(true);
      setPurchaseError(null);

      const result = await sendNimPayment({
        recipient: NIM_RECIPIENT,
        value: CAR_PRICE_LUNA,
        data: `NimiqRacer:${car.name}`,
      });

      if (result.success) {
        // Record purchase in database
        await recordPurchase({
          deviceId,
          carHex: car.hex,
          carName: car.name,
          txHash: result.txHash,
          priceLuna: CAR_PRICE_LUNA,
        }).catch(() => {});

        // Refresh owned cars from database
        const purchases = await fetchPurchases(deviceId).catch(() => []);
        setOwnedCarHexes(new Set(purchases.map((p) => p.car_hex)));
        setSelectedCar(index);
        setPurchasing(false);
      } else {
        setPurchasing(false);
        setPurchaseError(result.error || "Purchase failed");
        setTimeout(() => setPurchaseError(null), 3000);
      }
    },
    [isReady, deviceId, isCarAvailable]
  );

  if (step === "playing") {
    return (
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #1a3a5c 0%, #2266cc 50%, #77bbff 100%)",
              color: "white",
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            Loading race...
          </div>
        }
      >
        <EnhancedCarRaceGame
          username={username}
          selectedCarColor={CAR_OPTIONS[selectedCar].color}
          onHome={() => setStep("car_select")}
        />
      </Suspense>
    );
  }

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
        {showLeaderboard ? "← Back" : "Leaderboard"}
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
            marginBottom: "36px",
            opacity: 0.85,
          }}
        >
          Race. Score. Repeat.
        </p>

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
                const available = isCarAvailable(car);
                const isSelected = selectedCar === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleCarClick(i)}
                    disabled={purchasing || loadingPurchases}
                    style={{
                      padding: "16px 8px",
                      borderRadius: "12px",
                      border: isSelected
                        ? "3px solid #22cc88"
                        : "2px solid rgba(255,255,255,0.2)",
                      background: isSelected
                        ? "rgba(34,204,136,0.15)"
                        : "rgba(255,255,255,0.05)",
                      cursor: purchasing || loadingPurchases ? "wait" : "pointer",
                      transition: "all 0.2s ease",
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center",
                      gap: "8px",
                      opacity: purchasing || loadingPurchases ? 0.6 : 1,
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
                        fontSize: "11px",
                        fontWeight: isSelected ? "bold" : "normal",
                        opacity: available ? (isSelected ? 1 : 0.7) : 0.5,
                      }}
                    >
                      {car.name}
                    </span>
                    {car.premium && available && (
                      <span style={{ fontSize: "10px", color: "#22cc88", fontWeight: "bold" }}>
                        Owned
                      </span>
                    )}
                    {car.premium && !available && (
                      <span style={{ fontSize: "10px", color: "#ffd700", fontWeight: "bold" }}>
                        {formatNim(CAR_PRICE_LUNA)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                if (isCarAvailable(CAR_OPTIONS[selectedCar])) setStep("playing");
              }}
              disabled={!isCarAvailable(CAR_OPTIONS[selectedCar])}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "10px",
                border: "none",
                background: isCarAvailable(CAR_OPTIONS[selectedCar])
                  ? "linear-gradient(45deg, #22cc88, #44ddaa)"
                  : "#555",
                color: isCarAvailable(CAR_OPTIONS[selectedCar]) ? "#1a1a2e" : "#999",
                fontSize: "17px",
                fontWeight: "bold",
                cursor: isCarAvailable(CAR_OPTIONS[selectedCar]) ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
                marginBottom: "12px",
              }}
            >
              Start Racing
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
