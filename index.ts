import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";

// Silence dotenv logging to stdout as it breaks MCP protocol
dotenv.config();

const BLOGHUNCH_API_URL = process.env.BLOGHUNCH_API_URL || "https://api.bloghunch.com/api/v1";
const BLOGHUNCH_API_KEY = process.env.BLOGHUNCH_API_KEY;
const BLOGHUNCH_SUBDOMAIN = process.env.BLOGHUNCH_SUBDOMAIN;

if (!BLOGHUNCH_API_KEY) {
  console.error("BLOGHUNCH_API_KEY is required");
  process.exit(1);
}

const apiClient = axios.create({
  baseURL: BLOGHUNCH_API_URL,
  headers: {
    Authorization: `Bearer ${BLOGHUNCH_API_KEY}`,
    Accept: "application/json",
  },
  params: {
    subdomain: BLOGHUNCH_SUBDOMAIN,
  },
});

const server = new Server(
  {
    name: "bloghunch-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "bh_get_stats",
        description: "Get analytics summary for the publication",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "bh_generate_ideas",
        description: "Brainstorm blog post ideas using AI Studio",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "The main topic to brainstorm about" },
          },
          required: ["topic"],
        },
      },
      {
        name: "bh_list_posts",
        description: "List blog posts with optional status filter",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["draft", "published", "scheduled"], description: "Filter by status" },
          },
        },
      },
      {
        name: "bh_create_post",
        description: "Create a blog post (Manual or AI-Generated). Provide 'topic' to trigger high-quality AI generation.",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Trigger AI generation for this topic (RAG-powered, fact-checked)" },
            location: { type: "string", description: "Regional context for AI generation" },
            targetAudience: { type: "string", description: "Target audience for AI generation" },
            title: { type: "string", description: "Manual title (for non-AI posts)" },
            content: { type: "string", description: "Manual content (for non-AI posts)" },
            excerpt: { type: "string", description: "Manual excerpt" },
          }
        },
      },
      {
        name: "bh_list_subscribers",
        description: "List newsletter subscribers",
        inputSchema: {
          type: "object",
          properties: {},
        }
      },
      {
        name: "bh_social_echo",
        description: "Generate social media assets (Twitter, LinkedIn, Newsletter) for a blog post",
        inputSchema: {
          type: "object",
          properties: {
            postId: { type: "number" }
          },
          required: ["postId"]
        }
      },
      {
        name: "bh_discover_topics",
        description: "Trigger Google Search Console analysis to find SEO-driven topic opportunities",
        inputSchema: {
          type: "object",
          properties: {
            niche: { type: "string", description: "Your blog niche (e.g., 'SaaS Marketing')" },
            targetAudience: { type: "string", description: "Who are you writing for?" },
            contentGoals: { type: "string", description: "What do you want to achieve?" }
          },
          required: ["niche", "targetAudience", "contentGoals"]
        }
      },
      {
        name: "bh_get_topic_discoveries",
        description: "List SEO-driven topic opportunities found by Bloghunch",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "approved", "rejected", "written"] },
            priority: { type: "string", enum: ["high", "medium", "low"] }
          }
        }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const anyArgs = args as any;

  try {
    switch (name) {
      case "bh_get_stats": {
        const response = await apiClient.get("/mcp/stats");
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_generate_ideas": {
        const response = await apiClient.post("/mcp/ai/ideas", { topic: anyArgs?.topic });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_list_posts": {
        const response = await apiClient.get("/mcp/posts", { params: { status: anyArgs?.status } });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_create_post": {
        if (anyArgs?.topic) {
          // Trigger high-quality AI orchestration
          console.error(`Generating high-quality post for topic: ${anyArgs.topic}...`);
          const response = await apiClient.post("/mcp/posts/generate-high-quality", {
            topic: anyArgs.topic,
            location: anyArgs.location,
            targetAudience: anyArgs.targetAudience
          });
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } else {
          // Manual creation
          const response = await apiClient.post("/mcp/posts", anyArgs);
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        }
      }
      case "bh_list_subscribers": {
        const response = await apiClient.get("/mcp/subscribers");
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_social_echo": {
        const response = await apiClient.post("/mcp/social-echo/generate", { postId: anyArgs?.postId });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_discover_topics": {
        const response = await apiClient.post("/mcp/topics/discover", anyArgs);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      case "bh_get_topic_discoveries": {
        const response = await apiClient.get("/mcp/topics/discoveries", { params: anyArgs });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error("Tool execution error:", error.response?.data || error.message);
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    return {
      isError: true,
      content: [{ type: "text", text: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) }],
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bloghunch MCP Server running on stdio (using /mcp endpoints)");
}

runServer().catch(console.error);
