#!/usr/bin/env node
/**
 * Bloghunch MCP Server — Entry Point
 *
 * Dispatches to the correct transport based on the TRANSPORT env var:
 *   TRANSPORT=stdio  → Claude Desktop & Cursor  (default)
 *   TRANSPORT=http   → ChatGPT (Streamable HTTP + OAuth 2.1 PKCE)
 */

import dotenv from "dotenv";
dotenv.config();

const mode = process.env.TRANSPORT ?? "stdio";

if (mode === "http") {
  const { startHttpServer } = await import("./src/http.js");
  startHttpServer().catch((e: Error) => {
    console.error("[Bloghunch MCP] Fatal error:", e);
    process.exit(1);
  });
} else {
  const { startStdioServer } = await import("./src/stdio.js");
  startStdioServer().catch((e: Error) => {
    console.error("[Bloghunch MCP] Fatal error:", e);
    process.exit(1);
  });
}
