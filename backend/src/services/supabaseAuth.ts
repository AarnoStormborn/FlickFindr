/** Verify a Supabase access token and return its user id. */
import { config } from "../config.js";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: "not-configured" | "invalid" | "unavailable" };

// Auth is checked by Supabase itself rather than trusting decoded JWT claims.
// A short-lived cache avoids one extra auth network round trip on each sync push.
const verified = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();
const CACHE_MS = 30_000;

export function supabaseAuthConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export async function verifySupabaseToken(token: string): Promise<AuthResult> {
  if (!supabaseAuthConfigured()) return { ok: false, reason: "not-configured" };
  const hit = verified.get(token);
  if (hit && hit.expiresAt > Date.now()) return { ok: true, user: hit.user };

  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid" };
    if (!res.ok) return { ok: false, reason: "unavailable" };

    const body = (await res.json()) as { id?: unknown; email?: unknown };
    if (typeof body.id !== "string") return { ok: false, reason: "invalid" };
    const user: AuthenticatedUser = {
      id: body.id,
      ...(typeof body.email === "string" ? { email: body.email } : {}),
    };
    verified.set(token, { user, expiresAt: Date.now() + CACHE_MS });
    if (verified.size > 500) {
      const first = verified.keys().next().value;
      if (first !== undefined) verified.delete(first);
    }
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Test seam: never retain a token between tests. */
export function clearVerifiedUsers(): void {
  verified.clear();
}
