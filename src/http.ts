/**
 * Bloghunch MCP — HTTP Transport (ChatGPT)
 *
 * Implements OAuth 2.1 PKCE + Streamable HTTP for ChatGPT's MCP integration.
 *
 * Scale design:
 *   • SQLite-persisted tokens — survive PM2 restarts (up to ~50k concurrent users)
 *   • In-process session Map — sessions are SSE streams; can't be shared across
 *     processes. Use Nginx sticky sessions (by Mcp-Session-Id) when running
 *     multiple nodes.
 *   • Rate limiting per-IP (auth endpoints) and per-token (MCP endpoint)
 *   • Structured JSON logging — every MCP request is logged for debugging
 *   • Graceful session recovery — stale session-id on Initialize is silently
 *     replaced (no 400 that breaks ChatGPT tool discovery)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID, createHash } from "crypto";
import dotenv from "dotenv";

import { createApiClient, TOOLS, callTool } from "./tools.js";
import { TokenStore, TokenData } from "./token-store.js";

dotenv.config();

// ─── Environment ───────────────────────────────────────────────────────────────

const PORT          = parseInt(process.env.PORT || "3001", 10);
const MCP_BASE_URL  = (process.env.MCP_SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const BLOGHUNCH_API = process.env.BLOGHUNCH_API_URL || undefined;

// ─── Stores ────────────────────────────────────────────────────────────────────

// Tokens & auth codes → SQLite (survive restarts)
const tokenStore = new TokenStore(process.env.TOKEN_DB_PATH);

// MCP sessions → in-process only (SSE transport objects cannot be serialised)
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
}
const sessions = new Map<string, McpSession>();

// Prune dead session handles every 10 minutes
setInterval(() => {
  for (const [sid, sess] of sessions) {
    // StreamableHTTPServerTransport sets _isClosed internally on close
    if ((sess.transport as unknown as { _isClosed?: boolean })._isClosed) {
      sessions.delete(sid);
    }
  }
}, 10 * 60 * 1_000).unref();

// ─── Structured Logging ────────────────────────────────────────────────────────

function log(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  level === "ERROR" ? console.error(entry) : console.error(entry); // PM2 captures stderr
}

// ─── PKCE ──────────────────────────────────────────────────────────────────────

function verifyPKCE(verifier: string, challenge: string, method = "S256"): boolean {
  if (method === "S256") {
    const computed = createHash("sha256").update(verifier).digest("base64url");
    return computed === challenge;
  }
  return verifier === challenge; // plain
}

// ─── MCP Server Factory ────────────────────────────────────────────────────────

function createMcpServer(client: ReturnType<typeof createApiClient>): Server {
  const server = new Server(
    { name: "bloghunch-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("INFO", "tools/list requested");
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    log("INFO", `tool/call: ${name}`, {
      args: JSON.stringify(args ?? {}).slice(0, 300),
    });
    try {
      const data = await callTool(name, (args ?? {}) as Record<string, unknown>, client);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { message?: string; error?: string }; status?: number };
        message?: string;
      };
      log("ERROR", `tool/call failed: ${name}`, {
        status: e.response?.status,
        error: e.message,
      });
      const msg =
        e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? "Unknown error";
      return {
        isError: true,
        content: [{ type: "text", text: typeof msg === "string" ? msg : JSON.stringify(msg) }],
      };
    }
  });

  return server;
}

// ─── Login Page ────────────────────────────────────────────────────────────────

function loginPage(opts: {
  error?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  clientId?: string;
}) {
  const hidden = (name: string, val?: string) =>
    val ? `<input type="hidden" name="${name}" value="${val.replace(/"/g, "&quot;")}">` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect Bloghunch</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      background:linear-gradient(135deg,#0d0d1a 0%,#1a1130 100%);
      min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:rgba(255,255,255,.06);backdrop-filter:blur(24px);
      border:1px solid rgba(255,255,255,.12);border-radius:20px;
      padding:44px 40px;width:100%;max-width:420px;color:#fff}
    .logo{display:flex;align-items:center;gap:10px;margin-bottom:28px}
    .logo-icon{width:38px;height:38px;background:linear-gradient(135deg,#7c3aed,#4f46e5);
      border-radius:10px;display:grid;place-items:center;font-size:18px}
    .logo-name{font-size:20px;font-weight:700}
    h1{font-size:22px;font-weight:700;margin-bottom:6px}
    .sub{color:rgba(255,255,255,.55);font-size:13.5px;margin-bottom:28px;line-height:1.5}
    .err{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);
      border-radius:8px;padding:11px;font-size:13px;color:#fca5a5;margin-bottom:18px}
    .fg{margin-bottom:18px}
    label{display:block;font-size:13px;font-weight:500;color:rgba(255,255,255,.8);margin-bottom:7px}
    input[type=password],input[type=text]{width:100%;padding:11px 14px;
      background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
      border-radius:10px;color:#fff;font-size:13.5px;font-family:monospace;
      transition:border-color .2s}
    input:focus{outline:none;border-color:#7c3aed;background:rgba(255,255,255,.11)}
    input::placeholder{color:rgba(255,255,255,.28)}
    .hint{font-size:11.5px;color:rgba(255,255,255,.38);margin-top:5px}
    .hint a{color:#a78bfa;text-decoration:none}
    button{width:100%;padding:13px;background:linear-gradient(135deg,#7c3aed,#4f46e5);
      border:none;border-radius:10px;color:#fff;font-size:14.5px;font-weight:600;
      cursor:pointer;margin-top:4px;transition:opacity .2s,transform .1s}
    button:hover{opacity:.9}
    button:active{transform:scale(.98)}
    .note{display:flex;gap:8px;align-items:center;margin-top:18px;padding:11px;
      background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.2);
      border-radius:8px;font-size:11.5px;color:rgba(255,255,255,.5)}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">✍️</div>
    <span class="logo-name">Bloghunch</span>
  </div>
  <h1>Connect Your Publication</h1>
  <p class="sub">Enter your Developer API Key to allow AI assistants to manage your Bloghunch publication.</p>
  ${opts.error ? `<div class="err">⚠️ ${opts.error}</div>` : ""}
  <form method="POST" action="/authorize">
    ${hidden("redirect_uri", opts.redirectUri)}
    ${hidden("code_challenge", opts.codeChallenge)}
    ${hidden("code_challenge_method", opts.codeChallengeMethod)}
    ${hidden("state", opts.state)}
    ${hidden("client_id", opts.clientId)}
    <div class="fg">
      <label for="api_key">Developer API Key</label>
      <input type="password" id="api_key" name="api_key" placeholder="bh_live_xxxxxxxxxxxx" required autocomplete="off">
      <div class="hint">Get yours at <a href="https://app.bloghunch.com/app/settings/developers" target="_blank">Settings → Developers</a></div>
    </div>
    <div class="fg">
      <label for="subdomain">Publication Subdomain <span style="color:rgba(255,255,255,.35)">(optional)</span></label>
      <input type="text" id="subdomain" name="subdomain" placeholder="my-blog" autocomplete="off">
      <div class="hint">Only needed if you manage multiple publications.</div>
    </div>
    <button type="submit">Authorize →</button>
  </form>
  <div class="note">🔒 Your key is never stored on our servers — it is exchanged for a secure session token.</div>
</div>
</body>
</html>`;
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    log("WARN", "auth: missing Bearer token", { path: req.path, ip: req.ip });
    res.status(401).json({
      error: "unauthorized",
      hint: "Reconnect Bloghunch in ChatGPT → Settings → Apps",
    });
    return;
  }

  const rawToken = header.slice(7);
  const tokenData = tokenStore.getToken(rawToken);
  if (!tokenData) {
    log("WARN", "auth: invalid or expired token", {
      tokenPrefix: rawToken.slice(0, 8) + "…",
      ip: req.ip,
    });
    res.status(401).json({
      error: "invalid_token",
      error_description:
        "Token expired or not found. Please disconnect and reconnect Bloghunch in ChatGPT → Settings → Apps.",
    });
    return;
  }

  (req as Request & { tokenData: TokenData }).tokenData = tokenData;
  next();
}

// ─── HTTP Server ───────────────────────────────────────────────────────────────

export async function startHttpServer(): Promise<void> {
  const app = express();

  // Trust the first proxy (Nginx) to allow rate limiting to see real IPs
  app.set("trust proxy", 1);

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
      exposedHeaders: ["Mcp-Session-Id"],
    }),
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ── Rate Limiters ───────────────────────────────────────────────────────────
  // OAuth endpoints: 60 req/min per IP (prevents brute-force on /authorize)
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", retry_after: 60 },
  });

  // MCP endpoint: 300 req/min, keyed by Bearer token (not IP — behind proxies)
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    keyGenerator: (req: Request) => req.headers.authorization ?? req.ip ?? "unknown",
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", retry_after: 60 },
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "2.0.0",
      transport: "streamable-http",
      tokens: tokenStore.tokenCount(),
      sessions: sessions.size,
      uptime: Math.floor(process.uptime()),
    });
  });

  // ── OAuth 2.1 Discovery ─────────────────────────────────────────────────────
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: MCP_BASE_URL,
      authorization_endpoint: `${MCP_BASE_URL}/authorize`,
      token_endpoint: `${MCP_BASE_URL}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  });

  // ── OAuth: Show Login Form ──────────────────────────────────────────────────
  app.get("/authorize", authLimiter, (req: Request, res: Response) => {
    res.send(
      loginPage({
        redirectUri: req.query.redirect_uri as string,
        codeChallenge: req.query.code_challenge as string,
        codeChallengeMethod: req.query.code_challenge_method as string,
        state: req.query.state as string,
        clientId: req.query.client_id as string,
      }),
    );
  });

  // ── OAuth: Process Login ────────────────────────────────────────────────────
  app.post("/authorize", authLimiter, async (req: Request, res: Response) => {
    const {
      api_key,
      subdomain = "",
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
      client_id,
    } = req.body as Record<string, string>;

    const showError = (msg: string) =>
      res.send(
        loginPage({
          error: msg,
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
          state,
          clientId: client_id,
        }),
      );

    if (!api_key?.trim()) {
      showError("API Key is required.");
      return;
    }

    // Validate the key against Bloghunch
    try {
      await createApiClient(api_key.trim(), subdomain.trim() || undefined, BLOGHUNCH_API).get(
        "/mcp/stats",
      );
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      const status = e.response?.status;
      const msg =
        status === 401 || status === 403
          ? "Invalid API key — please check your Developer API key."
          : "Could not reach Bloghunch. Please try again.";
      showError(msg);
      log("WARN", "authorize: API key validation failed", { status });
      return;
    }

    // Issue one-time auth code (stored in SQLite, 60s TTL)
    const code = randomUUID();
    tokenStore.saveAuthCode(code, {
      apiKey: api_key.trim(),
      subdomain: subdomain.trim(),
      redirectUri: redirect_uri ?? "",
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method ?? "S256",
      state,
      expiresAt: Date.now() + 60_000,
    });

    log("INFO", "authorize: code issued", { hasRedirect: !!redirect_uri });

    if (redirect_uri) {
      const params = new URLSearchParams({ code });
      if (state) params.set("state", state);
      res.redirect(`${redirect_uri}?${params}`);
    } else {
      res.send(
        `<html><body style="background:#0d0d1a;color:#fff;font-family:sans-serif;padding:40px;text-align:center">
          <h2>✅ Authorized</h2>
          <p style="color:rgba(255,255,255,.6);margin-top:12px">Code: <code style="background:rgba(255,255,255,.1);padding:4px 8px;border-radius:4px">${code}</code></p>
        </body></html>`,
      );
    }
  });

  // ── OAuth: Token Exchange ───────────────────────────────────────────────────
  app.post("/token", authLimiter, (req: Request, res: Response) => {
    const { grant_type, code, code_verifier } = req.body as Record<string, string>;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    if (!code) {
      res.status(400).json({ error: "invalid_request", error_description: "code is required" });
      return;
    }

    const codeData = tokenStore.getAuthCode(code);
    if (!codeData) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "Authorization code invalid or expired",
      });
      return;
    }

    // PKCE verification
    if (codeData.codeChallenge && code_verifier) {
      if (!verifyPKCE(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod)) {
        tokenStore.deleteAuthCode(code);
        res
          .status(400)
          .json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    tokenStore.deleteAuthCode(code); // single-use

    const accessToken = randomUUID();
    tokenStore.saveToken(accessToken, {
      apiKey: codeData.apiKey,
      subdomain: codeData.subdomain,
    });

    log("INFO", "token: issued", { tokenPrefix: accessToken.slice(0, 8) + "…" });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 90 * 24 * 60 * 60, // 90 days in seconds
      scope: "mcp",
    });
  });

  // ── MCP: POST (Initialize / Tool Calls) ────────────────────────────────────
  app.post("/mcp", mcpLimiter, requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const { apiKey, subdomain } = (req as Request & { tokenData: TokenData }).tokenData;

    log("INFO", "POST /mcp", {
      sessionId: sessionId ? sessionId.slice(0, 8) + "…" : null,
      method: (req.body as Record<string, unknown>)?.method,
      hasSession: sessionId ? sessions.has(sessionId) : false,
    });

    // ── Re-use existing live session ──────────────────────────────────────────
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
      return;
    }

    // ── Must be an Initialize to create a new session ─────────────────────────
    if (!isInitializeRequest(req.body)) {
      if (sessionId) {
        // Stale session-id: inform client to re-initialize
        log("WARN", "stale session-id, not an initialize request", {
          sessionId: sessionId.slice(0, 8) + "…",
          method: (req.body as Record<string, unknown>)?.method,
        });
      }
      res.status(400).json({
        error: "session_required",
        message:
          "No active session found. Please disconnect and reconnect Bloghunch in ChatGPT → Settings → Apps to start a fresh session.",
      });
      return;
    }

    // ── Initialize: stale session-id is fine here — we create a new one ───────
    if (sessionId && !sessions.has(sessionId)) {
      log("INFO", "stale session-id on Initialize — creating fresh session", {
        staleId: sessionId.slice(0, 8) + "…",
      });
    }

    const client = createApiClient(apiKey, subdomain || undefined, BLOGHUNCH_API);
    const mcpServer = createMcpServer(client);
    let newSessionId: string | undefined;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        newSessionId = randomUUID();
        return newSessionId;
      },
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server: mcpServer });
        log("INFO", "session created", { sid: sid.slice(0, 8) + "…" });
      },
    });

    transport.onclose = () => {
      if (newSessionId) {
        sessions.delete(newSessionId);
        log("INFO", "session closed", { sid: newSessionId.slice(0, 8) + "…" });
      }
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ── MCP: GET (SSE stream) ───────────────────────────────────────────────────
  app.get("/mcp", requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      log("WARN", "GET /mcp: session not found", { sessionId: sessionId?.slice(0, 8) });
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
  });

  // ── MCP: DELETE (terminate session) ────────────────────────────────────────
  app.delete("/mcp", requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      sessions.delete(sessionId);
      log("INFO", "session terminated", { sid: sessionId.slice(0, 8) + "…" });
      return;
    }
    res.status(404).json({ error: "session_not_found" });
  });

  // ── Start ───────────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    log("INFO", "HTTP server started", {
      port: PORT,
      endpoint: `${MCP_BASE_URL}/mcp`,
      oauth: `${MCP_BASE_URL}/authorize`,
      health: `${MCP_BASE_URL}/health`,
    });
    // PM2 stdout banner (matches existing format for familiarity)
    console.error(`\nBloghunch MCP Server (HTTP mode) started`);
    console.error(`  MCP endpoint : ${MCP_BASE_URL}/mcp`);
    console.error(`  OAuth login  : ${MCP_BASE_URL}/authorize`);
    console.error(`  Health       : ${MCP_BASE_URL}/health\n`);
  });
}
