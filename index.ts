/**
 * Bloghunch MCP Server
 *
 * Supports two transport modes:
 *   TRANSPORT=stdio  → Claude Desktop & Cursor  (default)
 *   TRANSPORT=http   → ChatGPT (Streamable HTTP + OAuth 2.1 PKCE)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID, createHash } from "crypto";

dotenv.config();

// ─── Environment ──────────────────────────────────────────────────────────────
const TRANSPORT_MODE = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3001", 10);
const MCP_SERVER_URL = (process.env.MCP_SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const BLOGHUNCH_API_URL = (process.env.BLOGHUNCH_API_URL || "https://api.bloghunch.com/api/v1").replace(/\/$/, "");

// STDIO-only env vars
const STDIO_API_KEY = process.env.BLOGHUNCH_API_KEY;
const STDIO_SUBDOMAIN = process.env.BLOGHUNCH_SUBDOMAIN;

// ─── API Client Factory ────────────────────────────────────────────────────────
function createApiClient(apiKey: string, subdomain?: string) {
  return axios.create({
    baseURL: BLOGHUNCH_API_URL,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    params: subdomain ? { subdomain } : {},
    timeout: 120_000,
  });
}

type ApiClient = ReturnType<typeof createApiClient>;

// ─── Tool Definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "bh_get_stats",
    description: "Get analytics summary (pageviews, subscribers, posts) for the Bloghunch publication.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "bh_list_posts",
    description: "List blog posts. Optionally filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "publish", "scheduled"], description: "Filter by post status" },
        keyword: { type: "string", description: "Search by title keyword" },
      },
    },
  },
  {
    name: "bh_create_post",
    description: "Create a blog post. Provide 'topic' for high-quality AI generation (SEO brief → RAG evidence → BullMQ job). Returns a receipt immediately; post appears in dashboard within minutes.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "AI-generate a post about this topic (recommended)" },
        location: { type: "string", description: "Regional context for AI generation" },
        targetAudience: { type: "string", description: "Who is this post for?" },
        title: { type: "string", description: "Manual title (skip topic for manual creation)" },
        content: { type: "string", description: "Manual HTML/Markdown content" },
        excerpt: { type: "string", description: "Short excerpt" },
        status: { type: "string", enum: ["draft", "publish"], description: "Post status (manual only)" },
      },
    },
  },
  {
    name: "bh_generate_ideas",
    description: "Brainstorm 5 unique blog post angles for a topic using AI.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to brainstorm ideas about" },
      },
      required: ["topic"],
    },
  },
  {
    name: "bh_list_subscribers",
    description: "List newsletter subscribers for the publication.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "bh_social_echo",
    description: "Generate Twitter thread, LinkedIn post, and newsletter teaser for an existing blog post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "number", description: "ID of the blog post" },
      },
      required: ["postId"],
    },
  },
  {
    name: "bh_discover_topics",
    description: "Trigger AI analysis of Google Search Console data to find high-potential SEO topic opportunities.",
    inputSchema: {
      type: "object",
      properties: {
        niche: { type: "string", description: "Your blog niche (e.g. 'SaaS Marketing')" },
        targetAudience: { type: "string", description: "Who are you writing for?" },
        contentGoals: { type: "string", description: "What do you want to achieve?" },
      },
      required: ["niche", "targetAudience", "contentGoals"],
    },
  },
  {
    name: "bh_get_topic_discoveries",
    description: "List SEO-driven topic opportunities discovered by Bloghunch.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "approved", "rejected", "written"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
      },
    },
  },
];

// ─── Tool Handler ──────────────────────────────────────────────────────────────
async function callTool(name: string, args: any, client: ApiClient) {
  switch (name) {
    case "bh_get_stats": {
      const r = await client.get("/mcp/stats");
      return r.data;
    }
    case "bh_list_posts": {
      const r = await client.get("/mcp/posts", { params: { status: args?.status, keyword: args?.keyword } });
      return r.data;
    }
    case "bh_create_post": {
      if (args?.topic) {
        console.error(`[MCP] AI generation triggered for: ${args.topic}`);
        const r = await client.post("/mcp/posts/generate-high-quality", {
          topic: args.topic,
          location: args.location,
          targetAudience: args.targetAudience,
        });
        return r.data;
      }
      const r = await client.post("/mcp/posts", {
        title: args?.title,
        content: args?.content,
        excerpt: args?.excerpt,
        status: args?.status || "draft",
      });
      return r.data;
    }
    case "bh_generate_ideas": {
      const r = await client.post("/mcp/ai/ideas", { topic: args?.topic });
      return r.data;
    }
    case "bh_list_subscribers": {
      const r = await client.get("/mcp/subscribers");
      return r.data;
    }
    case "bh_social_echo": {
      const r = await client.post("/mcp/social-echo/generate", { postId: args?.postId });
      return r.data;
    }
    case "bh_discover_topics": {
      const r = await client.post("/mcp/topics/discover", args);
      return r.data;
    }
    case "bh_get_topic_discoveries": {
      const r = await client.get("/mcp/topics/discoveries", { params: args });
      return r.data;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server Factory ────────────────────────────────────────────────────────
function createMcpServer(client: ApiClient): Server {
  const server = new Server(
    { name: "bloghunch-mcp", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const data = await callTool(name, args as any, client);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      console.error(`[MCP] Tool error (${name}):`, err.response?.data || err.message);
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      return {
        isError: true,
        content: [{ type: "text", text: typeof msg === "string" ? msg : JSON.stringify(msg) }],
      };
    }
  });

  return server;
}

// ══════════════════════════════════════════════════════════════════════════════
// STDIO MODE — Claude Desktop & Cursor
// ══════════════════════════════════════════════════════════════════════════════
async function startStdioServer() {
  if (!STDIO_API_KEY) {
    console.error("BLOGHUNCH_API_KEY is required in STDIO mode.");
    process.exit(1);
  }
  const client = createApiClient(STDIO_API_KEY, STDIO_SUBDOMAIN);
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bloghunch MCP Server running on stdio (Claude / Cursor)");
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP MODE — ChatGPT (Streamable HTTP + OAuth 2.1 PKCE)
// ══════════════════════════════════════════════════════════════════════════════

// ── In-memory stores ──────────────────────────────────────────────────────────
interface AuthCodeData {
  apiKey: string;
  subdomain: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  expiresAt: number;
}
interface TokenData {
  apiKey: string;
  subdomain: string;
}
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

const authCodes = new Map<string, AuthCodeData>();
const tokens = new Map<string, TokenData>();
const sessions = new Map<string, McpSession>();

// ── PKCE ──────────────────────────────────────────────────────────────────────
function verifyPKCE(verifier: string, challenge: string, method = "S256"): boolean {
  if (method === "S256") {
    const computed = createHash("sha256").update(verifier).digest("base64url");
    return computed === challenge;
  }
  return verifier === challenge; // plain
}

// ── Login page HTML ───────────────────────────────────────────────────────────
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
  <div class="note">🔒 Your key is never stored — it is exchanged for a secure session token.</div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
async function startHttpServer() {
  const app = express();

  app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"], exposedHeaders: ["Mcp-Session-Id"] }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => res.json({ status: "ok", version: "1.1.0", transport: "streamable-http" }));

  // ── OAuth 2.1 Discovery ─────────────────────────────────────────────────────
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: MCP_SERVER_URL,
      authorization_endpoint: `${MCP_SERVER_URL}/authorize`,
      token_endpoint: `${MCP_SERVER_URL}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  });

  // ── OAuth: Show Login Form ──────────────────────────────────────────────────
  app.get("/authorize", (req: Request, res: Response) => {
    res.send(loginPage({
      redirectUri: req.query.redirect_uri as string,
      codeChallenge: req.query.code_challenge as string,
      codeChallengeMethod: req.query.code_challenge_method as string,
      state: req.query.state as string,
      clientId: req.query.client_id as string,
    }));
  });

  // ── OAuth: Process Login ────────────────────────────────────────────────────
  app.post("/authorize", async (req: Request, res: Response) => {
    const { api_key, subdomain = "", redirect_uri, code_challenge, code_challenge_method, state, client_id } = req.body;

    if (!api_key?.trim()) {
      res.send(loginPage({ error: "API Key is required.", redirectUri: redirect_uri, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, state, clientId: client_id }));
      return;
    }

    // Validate the API key against Bloghunch
    try {
      await createApiClient(api_key.trim(), subdomain.trim() || undefined).get("/mcp/stats");
    } catch (err: any) {
      const status = err.response?.status;
      const msg = (status === 401 || status === 403)
        ? "Invalid API key — please check your Developer API key."
        : "Could not reach Bloghunch. Please try again.";
      res.send(loginPage({ error: msg, redirectUri: redirect_uri, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, state, clientId: client_id }));
      return;
    }

    // Issue auth code
    const code = randomUUID();
    authCodes.set(code, {
      apiKey: api_key.trim(),
      subdomain: subdomain.trim(),
      redirectUri: redirect_uri || "",
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || "S256",
      state,
      expiresAt: Date.now() + 60_000,
    });

    if (redirect_uri) {
      const params = new URLSearchParams({ code });
      if (state) params.set("state", state);
      res.redirect(`${redirect_uri}?${params}`);
    } else {
      res.send(`<html><body style="background:#0d0d1a;color:#fff;font-family:sans-serif;padding:40px;text-align:center"><h2>✅ Authorized</h2><p style="color:rgba(255,255,255,.6);margin-top:12px">Code: <code style="background:rgba(255,255,255,.1);padding:4px 8px;border-radius:4px">${code}</code></p></body></html>`);
    }
  });

  // ── OAuth: Token Exchange ───────────────────────────────────────────────────
  app.post("/token", (req: Request, res: Response) => {
    const { grant_type, code, code_verifier } = req.body;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    if (!code) {
      res.status(400).json({ error: "invalid_request", error_description: "code is required" });
      return;
    }

    const codeData = authCodes.get(code);
    if (!codeData || Date.now() > codeData.expiresAt) {
      authCodes.delete(code);
      res.status(400).json({ error: "invalid_grant", error_description: "Authorization code invalid or expired" });
      return;
    }

    if (codeData.codeChallenge && code_verifier) {
      if (!verifyPKCE(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod)) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    authCodes.delete(code);
    const accessToken = randomUUID();
    tokens.set(accessToken, { apiKey: codeData.apiKey, subdomain: codeData.subdomain });

    res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 7_776_000, scope: "mcp" });
  });

  // ── Bearer Token Middleware ─────────────────────────────────────────────────
  function auth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const tokenData = tokens.get(header.slice(7));
    if (!tokenData) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    (req as any).tokenData = tokenData;
    next();
  }

  // ── MCP: POST (Initialize / Tool Calls) ────────────────────────────────────
  app.post("/mcp", auth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const { apiKey, subdomain } = (req as any).tokenData as TokenData;

    // Re-use existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // Only allow creating sessions on Initialize
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: "bad_request", message: "No active session. Start with an Initialize request." });
      return;
    }

    // Create new session
    const client = createApiClient(apiKey, subdomain || undefined);
    const mcpServer = createMcpServer(client);
    let newSessionId: string | undefined;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        newSessionId = randomUUID();
        return newSessionId;
      },
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server: mcpServer });
        console.error(`[MCP HTTP] Session created: ${sid}`);
      },
    });

    transport.onclose = () => {
      if (newSessionId) {
        sessions.delete(newSessionId);
        console.error(`[MCP HTTP] Session closed: ${newSessionId}`);
      }
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ── MCP: GET (SSE stream) ───────────────────────────────────────────────────
  app.get("/mcp", auth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
  });

  // ── MCP: DELETE (terminate session) ────────────────────────────────────────
  app.delete("/mcp", auth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      sessions.delete(sessionId);
      console.error(`[MCP HTTP] Session terminated: ${sessionId}`);
      return;
    }
    res.status(404).json({ error: "session_not_found" });
  });

  app.listen(PORT, () => {
    console.error(`\nBloghunch MCP Server (HTTP mode) started`);
    console.error(`  MCP endpoint : ${MCP_SERVER_URL}/mcp`);
    console.error(`  OAuth login  : ${MCP_SERVER_URL}/authorize`);
    console.error(`  Health       : ${MCP_SERVER_URL}/health\n`);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (TRANSPORT_MODE === "http") {
  startHttpServer().catch((e) => { console.error("Fatal:", e); process.exit(1); });
} else {
  startStdioServer().catch((e) => { console.error("Fatal:", e); process.exit(1); });
}
