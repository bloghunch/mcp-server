/**
 * Bloghunch MCP — STDIO Transport
 *
 * Used by Claude Desktop & Cursor. The user installs this package locally and
 * configures their BLOGHUNCH_API_KEY in their own .env or claude_desktop_config.json.
 * No server is required — this process is spawned by the AI client directly.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createApiClient, TOOLS, callTool } from "./tools.js";

// ─── STDIO Server ──────────────────────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  const apiKey = process.env.BLOGHUNCH_API_KEY;

  if (!apiKey) {
    console.error(
      "[Bloghunch MCP] Error: BLOGHUNCH_API_KEY is required.\n" +
        "  Get your key at: https://app.bloghunch.com/app/settings/developers\n" +
        "  Then set it in your .env or your client's MCP server config.",
    );
    process.exit(1);
  }

  const subdomain = process.env.BLOGHUNCH_SUBDOMAIN || undefined;
  const baseUrl = process.env.BLOGHUNCH_API_URL || undefined;
  const client = createApiClient(apiKey, subdomain, baseUrl);

  const server = new Server(
    { name: "bloghunch-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const data = await callTool(name, (args ?? {}) as Record<string, unknown>, client);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
      console.error(`[MCP] Tool error (${name}):`, e.response?.data ?? e.message);
      const msg = e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? "Unknown error";
      return {
        isError: true,
        content: [{ type: "text", text: typeof msg === "string" ? msg : JSON.stringify(msg) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Bloghunch MCP] STDIO server running (Claude Desktop / Cursor)");
}
