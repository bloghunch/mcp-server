/**
 * Bloghunch MCP — Shared Tool Definitions & Handlers
 *
 * This is the single source of truth for all tools exposed by the Bloghunch
 * MCP server. Both transport modes (STDIO and HTTP) import from here so tool
 * definitions never drift apart.
 */

import axios from "axios";

// ─── API Client ────────────────────────────────────────────────────────────────

export const DEFAULT_API_URL = "https://api.bloghunch.com/api/v1";

export function createApiClient(apiKey: string, subdomain?: string, baseUrl?: string) {
  return axios.create({
    baseURL: (baseUrl || DEFAULT_API_URL).replace(/\/$/, ""),
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    params: subdomain ? { subdomain } : {},
    timeout: 120_000,
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

// ─── Tool Definitions ──────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "bh_get_stats",
    description:
      "Get analytics summary (pageviews, subscribers, posts) for the Bloghunch publication.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "bh_list_posts",
    description: "List blog posts. Optionally filter by status or keyword.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "publish", "scheduled"],
          description: "Filter by post status",
        },
        keyword: { type: "string", description: "Search by title keyword" },
      },
    },
  },
  {
    name: "bh_create_post",
    description:
      "Create a blog post. Provide 'topic' for high-quality AI generation (SEO brief → RAG evidence → BullMQ job). Returns a receipt immediately; post appears in dashboard within minutes.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "AI-generate a post about this topic (recommended)",
        },
        location: { type: "string", description: "Regional context for AI generation" },
        targetAudience: { type: "string", description: "Who is this post for?" },
        title: {
          type: "string",
          description: "Manual title (skip topic for manual creation)",
        },
        content: { type: "string", description: "Manual HTML/Markdown content" },
        excerpt: { type: "string", description: "Short excerpt" },
        status: {
          type: "string",
          enum: ["draft", "publish"],
          description: "Post status (manual only)",
        },
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
    description:
      "Generate Twitter thread, LinkedIn post, and newsletter teaser for an existing blog post.",
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
    description:
      "Trigger AI analysis of Google Search Console data to find high-potential SEO topic opportunities.",
    inputSchema: {
      type: "object",
      properties: {
        niche: {
          type: "string",
          description: "Your blog niche (e.g. 'SaaS Marketing')",
        },
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
        status: {
          type: "string",
          enum: ["pending", "approved", "rejected", "written"],
        },
        priority: { type: "string", enum: ["high", "medium", "low"] },
      },
    },
  },
] as const;

// ─── Tool Handler ──────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  client: ApiClient,
): Promise<unknown> {
  switch (name) {
    case "bh_get_stats": {
      const r = await client.get("/mcp/stats");
      return r.data;
    }
    case "bh_list_posts": {
      const r = await client.get("/mcp/posts", {
        params: { status: args?.status, keyword: args?.keyword },
      });
      return r.data;
    }
    case "bh_create_post": {
      if (args?.topic) {
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
