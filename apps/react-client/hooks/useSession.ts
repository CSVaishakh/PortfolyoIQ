"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchProfile, type AuthUser } from "@/lib/api";
import {
  clearSession,
  getServerToken,
  readToken,
  subscribeToSession,
  writeToken,
} from "@/lib/session";

export interface Session {
  /** Undefined until the first client render resolves — render nothing session-shaped before then. */
  token: string | null;
  signedIn: boolean;
  /** The account, once `/client/profile` has answered. Null while unknown. */
  user: AuthUser | null;
  signOut: () => void;
  signIn: (token: string) => void;
}

/**
 * Session state.
 *
 * `useSyncExternalStore` reads `localStorage` with a server snapshot of `null`,
 * so the markup matches on hydration (GL-07) without the setState-in-effect
 * cascade the previous implementation used — and a sign-out in another tab is
 * picked up through the `storage` event.
 */
export function useSession(): Session {
  const token = useSyncExternalStore(subscribeToSession, readToken, getServerToken);
  // Cached alongside the token it belongs to, so a token change invalidates the
  // profile by comparison rather than by resetting state from inside an effect.
  const [profile, setProfile] = useState<{ token: string; user: AuthUser } | null>(null);

  useEffect(() => {
    if (!token) return;

    let active = true;
    // A 401/403 here clears the token inside `request`, which re-runs this hook
    // through the store subscription and settles on the signed-out state.
    fetchProfile(token).then((result) => {
      if (active && result.ok) setProfile({ token, user: result.data.user });
    });

    return () => {
      active = false;
    };
  }, [token]);

  const user = profile && profile.token === token ? profile.user : null;

  return {
    token,
    signedIn: token !== null,
    user,
    signOut: clearSession,
    signIn: writeToken,
  };
}
