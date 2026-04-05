/**
 * Bloghunch MCP — SQLite-backed Token Store
 *
 * Replaces the in-memory Map<string, TokenData> so that OAuth access tokens
 * and auth codes survive PM2 restarts. Uses better-sqlite3 (synchronous API,
 * no event loop overhead, prebuilt binaries for Linux/macOS/Windows).
 *
 * Tables:
 *   tokens     — access tokens with 90-day TTL
 *   auth_codes — one-time use codes with 60-second TTL
 */

import Database from "better-sqlite3";
import path from "path";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TokenData {
  apiKey: string;
  subdomain: string;
}

export interface AuthCodeData {
  apiKey: string;
  subdomain: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  expiresAt: number;
}

// ─── TTLs ──────────────────────────────────────────────────────────────────────

const TOKEN_TTL_MS    = 90 * 24 * 60 * 60 * 1_000; // 90 days
const AUTH_CODE_TTL_MS = 60_000;                     // 60 seconds

// ─── Token Store ───────────────────────────────────────────────────────────────

export class TokenStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath || path.join(process.cwd(), "tokens.db");
    this.db = new Database(resolved);

    // WAL mode: allows concurrent reads while writing (important under load)
    this.db.pragma("journal_mode = WAL");
    // Don't block indefinitely if another process holds the lock
    this.db.pragma("busy_timeout = 5000");

    this._createTables();
    this.prune(); // clean stale rows on startup

    // Background pruning every 10 minutes (unref so it won't block process exit)
    setInterval(() => this.prune(), 10 * 60 * 1_000).unref();
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  private _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        token      TEXT PRIMARY KEY,
        api_key    TEXT NOT NULL,
        subdomain  TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_codes (
        code       TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tokens_exp     ON tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_codes_exp ON auth_codes(expires_at);
    `);
  }

  // ── Access Tokens ───────────────────────────────────────────────────────────

  saveToken(token: string, data: TokenData): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO tokens (token, api_key, subdomain, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(token, data.apiKey, data.subdomain, Date.now() + TOKEN_TTL_MS);
  }

  getToken(token: string): TokenData | null {
    const row = this.db
      .prepare("SELECT api_key, subdomain FROM tokens WHERE token = ? AND expires_at > ?")
      .get(token, Date.now()) as { api_key: string; subdomain: string } | undefined;

    return row ? { apiKey: row.api_key, subdomain: row.subdomain } : null;
  }

  deleteToken(token: string): void {
    this.db.prepare("DELETE FROM tokens WHERE token = ?").run(token);
  }

  tokenCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as n FROM tokens WHERE expires_at > ?")
      .get(Date.now()) as { n: number };
    return row.n;
  }

  // ── Auth Codes ──────────────────────────────────────────────────────────────

  saveAuthCode(code: string, data: AuthCodeData): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO auth_codes (code, data, expires_at) VALUES (?, ?, ?)",
      )
      .run(code, JSON.stringify(data), Date.now() + AUTH_CODE_TTL_MS);
  }

  getAuthCode(code: string): AuthCodeData | null {
    const row = this.db
      .prepare("SELECT data FROM auth_codes WHERE code = ? AND expires_at > ?")
      .get(code, Date.now()) as { data: string } | undefined;

    return row ? (JSON.parse(row.data) as AuthCodeData) : null;
  }

  deleteAuthCode(code: string): void {
    this.db.prepare("DELETE FROM auth_codes WHERE code = ?").run(code);
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────

  prune(): void {
    const now = Date.now();
    this.db.prepare("DELETE FROM tokens WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM auth_codes WHERE expires_at <= ?").run(now);
  }
}
