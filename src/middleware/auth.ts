import { getDb } from "../db";
import type { User, UserRole } from "../types";

// When PULSE_NO_AUTH=1 (set by the CLI `pulse run` for single-user / local
// installs), every route gets a synthetic admin and auth checks short-circuit.
// The systemd / multi-user deployment leaves this unset and behaves unchanged.
const NO_AUTH = process.env.PULSE_NO_AUTH === "1";

const LOCAL_ADMIN: User = {
  id: 0,
  username: "admin",
  display_name: "Admin",
  role: "admin",
};
const LOCAL_TOKEN = "local";

interface AuthSession {
  id: string;
  user_id: number;
  token: string;
  expires_at: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export function validateToken(token: string): User | null {
  const db = getDb();
  const session = db
    .query("SELECT * FROM auth_sessions WHERE token = ?")
    .get(token) as AuthSession | null;

  if (!session) return null;
  if (Date.now() > session.expires_at) {
    db.run("DELETE FROM auth_sessions WHERE id = ?", [session.id]);
    return null;
  }

  const user = db
    .query("SELECT id, username, display_name, role, created_at, updated_at FROM users WHERE id = ?")
    .get(session.user_id) as UserRow | null;

  if (!user) return null;
  return { ...user, role: user.role as UserRole };
}

export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function requireAuth(authHeader: string | null): { user: User; token: string } | Response {
  if (NO_AUTH) return { user: LOCAL_ADMIN, token: LOCAL_TOKEN };
  const token = extractToken(authHeader);
  if (!token) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = validateToken(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { user, token };
}

export function requireAdmin(authHeader: string | null): { user: User; token: string } | Response {
  const result = requireAuth(authHeader);
  if (result instanceof Response) return result;
  if (result.user.role !== "admin") {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return result;
}
