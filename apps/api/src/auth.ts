// Admin login and sessions (ADR-020): one account, bearer tokens, only hashes stored.

import type { RequestHandler } from "express";
import { HttpError } from "./errors";
import { deleteSession, insertSession, isSessionValid } from "./repo";
import { generateToken, hashToken } from "./token";

export const SESSION_HOURS = 8;

/** Constant-time comparison of two strings (compares their SHA-256 digests). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

export interface AdminAccount {
  username?: string;
  password?: string;
}

/** Checks the credentials and opens a session; throws 401 INVALID_CREDENTIALS. */
export async function login(
  db: D1Database,
  account: AdminAccount,
  username: string,
  password: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  // Without a configured password nobody can log in (fail closed).
  // Both are always compared, so the timing does not tell which one was wrong.
  const [userOk, passwordOk] = await Promise.all([
    sameSecret(username, account.username ?? ""),
    sameSecret(password, account.password ?? ""),
  ]);
  const ok = !!account.username && !!account.password && userOk && passwordOk;
  if (!ok) throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong username or password.");

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString();
  await insertSession(db, await hashToken(token), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

/**
 * Express middleware: lets the request through only with a valid, unexpired session.
 * Stores the token hash in res.locals.sessionHash (used by logout).
 */
export function requireAdmin(db: () => D1Database, now: () => Date): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get("authorization"));
    const tokenHash = token ? await hashToken(token) : null;
    if (!tokenHash || !(await isSessionValid(db(), tokenHash, now().toISOString()))) {
      next(new HttpError(401, "UNAUTHORIZED", "Log in to use the admin."));
      return;
    }
    res.locals.sessionHash = tokenHash;
    next();
  };
}

export async function logout(db: D1Database, sessionHash: string): Promise<void> {
  await deleteSession(db, sessionHash);
}
