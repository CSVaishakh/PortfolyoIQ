/**
 * Client session store.
 *
 * The JWT lives in `localStorage` under `token`, unchanged from the previous
 * implementation. SC-01 records this as an accepted risk pending a migration to
 * an httpOnly cookie set by the platform service; nothing here makes that
 * migration harder, because every read and write goes through this module.
 *
 * Exposed as an external store rather than component state so that
 * `useSyncExternalStore` can read it without a hydration mismatch and without
 * a setState-in-effect cascade, and so a sign-out in one tab is reflected in
 * the others through the `storage` event.
 */

const TOKEN_KEY = "token";

/** Same-tab writes don't fire `storage`, so changes are broadcast explicitly. */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", listener);
    }
  };
}

export function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private-mode or storage-disabled browsers: degrade to signed-out rather
    // than throwing out of a render.
    return null;
  }
}

export function writeToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session simply won't persist */
  }
  emit();
}

/**
 * SC-06: sign-out clears all client-held session state, not only the token key.
 * No portfolio-derived value is ever written to storage (SC-02), so the token
 * is the whole of it today; clearing is centralised here so it stays true.
 */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
  emit();
}

/** Server snapshot for `useSyncExternalStore` — always signed out during SSR. */
export function getServerToken(): null {
  return null;
}
