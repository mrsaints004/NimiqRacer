import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Nimiq Mini App SDK — lazy import so the game still works outside Nimiq Pay
// (the shop just won't function).
// ---------------------------------------------------------------------------

// The SDK's NimiqProvider type varies across versions; we only use a few methods.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nimiqProvider: any = null;
let sdkReady = false;

export async function initNimiq(): Promise<boolean> {
  if (sdkReady) return true;
  try {
    const sdk = await import("@nimiq/mini-app-sdk");
    nimiqProvider = await sdk.init();
    sdkReady = true;
    return true;
  } catch {
    console.warn("Nimiq SDK not available — running in standalone mode");
    return false;
  }
}

export async function getNimiqAccounts(): Promise<string[]> {
  if (!nimiqProvider) return [];
  try {
    const result = await nimiqProvider.listAccounts();
    if (Array.isArray(result)) return result;
    return [];
  } catch {
    return [];
  }
}

export async function getDeviceId(reason: string): Promise<string | null> {
  try {
    const sdk = await import("@nimiq/mini-app-sdk");
    return await sdk.requestDeviceIdentifier({ reason });
  } catch {
    return null;
  }
}

export async function sendNimPayment({
  recipient,
  value,
  data,
}: {
  recipient: string;
  value: number;
  data?: string;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!nimiqProvider) {
    return { success: false, error: "Nimiq SDK not initialized" };
  }
  try {
    const result = data
      ? await nimiqProvider.sendBasicTransactionWithData({ recipient, value, data })
      : await nimiqProvider.sendBasicTransaction({ recipient, value });

    // The SDK throws or returns an ErrorResponse on rejection/failure.
    // An ErrorResponse has a numeric `code` field. Anything else (string tx hash,
    // or any truthy value) means the transaction was accepted (possibly still pending).
    if (result && typeof result === "object" && "code" in result && typeof result.code === "number") {
      return { success: false, error: result.message || "Transaction rejected" };
    }

    // If we got here, the transaction was accepted by Nimiq Pay. It may still be
    // pending confirmation, but the user has approved and signed it — treat as success.
    return { success: true, txHash: typeof result === "string" ? result : undefined };
  } catch (err: unknown) {
    // User cancelled or SDK error
    const msg = (err instanceof Error ? err.message : String(err)) || "Transaction failed";
    return { success: false, error: msg };
  }
}

export async function signMessage(
  message: string
): Promise<{ publicKey: string; signature: string } | null> {
  if (!nimiqProvider) return null;
  try {
    const result = await nimiqProvider.sign(message);
    if (result && typeof result === "object" && "code" in result) return null;
    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// React context — provides SDK readiness, deviceId, and accounts to the tree
// ---------------------------------------------------------------------------

interface NimiqContextValue {
  isReady: boolean;
  deviceId: string | null;
  accounts: string[];
}

const NimiqContext = createContext<NimiqContextValue>({
  isReady: false,
  deviceId: null,
  accounts: [],
});

export function useNimiq() {
  return useContext(NimiqContext);
}

export function NimiqProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);

  const bootstrap = useCallback(async () => {
    const ok = await initNimiq();
    setIsReady(ok);
    if (ok) {
      const [accts, did] = await Promise.all([
        getNimiqAccounts(),
        getDeviceId("Leaderboard ranking and purchase tracking"),
      ]);
      setAccounts(accts);
      setDeviceId(did);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return createElement(
    NimiqContext.Provider,
    { value: { isReady, deviceId, accounts } },
    children
  );
}
