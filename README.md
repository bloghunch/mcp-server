# Bloghunch Model Context Protocol (MCP) Server

Connect your AI agent (Claude, ChatGPT, etc.) directly to your Bloghunch publication to automate high-quality content creation, distribution, and analytics.

## Core Features

-   **High-Quality "Pro" Content Generation**: Orchestrates a full AI pipeline (SEO Brief → Web Research → Fact-Checked Generation → Plagiarism Check) with a single command.
-   **SEO Topic Discovery**: Analyzes your Google Search Console data via AI to find high-potential, low-difficulty topic opportunities.
-   **Social Media "Social Echo"**: Instantly generates Twitter threads, LinkedIn posts, and newsletter teasers for any existing blog post.
-   **AI Studio Brainstorming**: Brainstorm ideas, draft outlines, and generate SEO-optimized content sections on the fly.
-   **Real-time Insights**: Get snapshot analytics (page views, subscriber growth, traffic sources) powered by Plausible integration.
-   **Metered & Billing Integrated**: Every AI operation correctly deducts usage credits based on your active Bloghunch plan.

## Installation for Claude Desktop

### macOS
If you are a Mac user with Claude Desktop:

1.  **Configure Environment**:
    Create a `.env` file in the `mcp-server` directory (see [Configuration](#configuration) below).

2.  **Auto-Install**:
    ```bash
    npm run install-claude
    ```
    This script will build the project and automatically configure your `claude_desktop_config.json`.

3.  **Restart Claude Desktop**.

### Windows
If you are a Windows user with Claude Desktop:

1.  **Configure Environment**:
    Create a `.env` file in the `mcp-server` directory (see [Configuration](#configuration) below).

2.  **Manual Configuration**:
    Open your Claude Desktop configuration file at:
    `%APPDATA%\Claude\claude_desktop_config.json`

3.  **Add MCP Server**:
    Insert the following into the `mcpServers` object (ensure you use double backslashes `\\` for the path):
    ```json
    "mcpServers": {
      "bloghunch": {
        "command": "node",
        "args": ["C:\\path\\to\\bloghunch\\mcp-server\\dist\\index.js"],
        "env": {
          "BLOGHUNCH_API_KEY": "YOUR_API_KEY",
          "BLOGHUNCH_API_URL": "https://api.bloghunch.com/api/v1",
          "BLOGHUNCH_SUBDOMAIN": "your-subdomain"
        }
      }
    }
    ```

4.  **Restart Claude Desktop**.

## Configuration

The server requires the following environment variables:

| Variable | Description |
| :--- | :--- |
| `BLOGHUNCH_API_KEY` | Your Bloghunch Developer API Key. |
| `BLOGHUNCH_API_URL` | Default: `https://api.bloghunch.com/api/v1` |
| `BLOGHUNCH_SUBDOMAIN`| (Optional) The specific publication subdomain to scope the tools to. |

## Available Tools

### Content Tools
-   `bh_create_post`: Create manual or AI-generated posts. Provide a `topic` to trigger the **Pro** orchestration flow.
-   `bh_list_posts`: Search and filter your blog posts.
-   `bh_social_echo`: Generate social media assets for an existing post.

### SEO & Discovery Tools
-   `bh_discover_topics`: Trigger AI analysis of your Google Search Console data.
-   `bh_get_topic_discoveries`: List and filter found topic opportunities.
-   `bh_generate_ideas`: Brainstorm 5 unique angles for any topic.

### Analytics & Audience
-   `bh_get_stats`: Snapshot of 7d/30d/90d publication performance.
-   `bh_list_subscribers`: View your latest newsletter signups.

## Local Development

1.  **Build**:
    ```bash
    npm run build
    ```
2.  **Run with standard IO**:
    ```bash
    npm start
    ```
    *Note: MCP servers communicate via stdio. Use stderr for diagnostic logging.*

---
© 2026 Bloghunch. Powering the next generation of AI-native blogging.
