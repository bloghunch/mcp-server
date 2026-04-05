# Bloghunch MCP Server

Connect your AI assistant directly to your Bloghunch publication to automate content creation, analytics, and distribution.

Supports **two transport modes**:
- **STDIO** — Claude Desktop & Cursor (local, no hosting needed)
- **HTTP** — ChatGPT (remote, requires public HTTPS URL)

---

## Tools Available

| Tool | Description |
|---|---|
| `bh_get_stats` | Analytics snapshot (pageviews, subscribers, posts) |
| `bh_list_posts` | List posts with status/keyword filter |
| `bh_create_post` | Create a post — provide `topic` for full AI generation |
| `bh_generate_ideas` | Brainstorm 5 post angles for any topic |
| `bh_list_subscribers` | List newsletter subscribers |
| `bh_social_echo` | Generate Twitter, LinkedIn, newsletter assets for a post |
| `bh_discover_topics` | Trigger GSC-powered SEO topic discovery |
| `bh_get_topic_discoveries` | List discovered topic opportunities |

---

## Installation — Claude Desktop & Cursor (STDIO)

### 1. Configure `.env`

```bash
cp .env.example .env
```

Fill in:
```
BLOGHUNCH_API_KEY=bh_live_xxxxxxxxxxxx
BLOGHUNCH_SUBDOMAIN=your-subdomain
BLOGHUNCH_API_URL=https://api.bloghunch.com/api/v1
```

Get your API key from [Settings → Developers](https://app.bloghunch.com/app/settings/developers).

### 2. Build & Auto-Install (macOS)

```bash
npm install
npm run build
npm run install-claude
```

Then restart Claude Desktop.

### 3. Manual Configuration (Windows / Cursor)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`) or Cursor MCP config:

```json
{
  "mcpServers": {
    "bloghunch": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "BLOGHUNCH_API_KEY": "bh_live_xxxxxxxxxxxx",
        "BLOGHUNCH_SUBDOMAIN": "your-subdomain",
        "BLOGHUNCH_API_URL": "https://api.bloghunch.com/api/v1"
      }
    }
  }
}
```

---

## Installation — ChatGPT (HTTP mode)

ChatGPT requires a **publicly hosted HTTPS server**. Run this on your VPS behind Nginx/Caddy.

### 1. Build

```bash
npm install
npm run build
```

### 2. Set environment variables on your server

```bash
export TRANSPORT=http
export PORT=3001
export MCP_SERVER_URL=https://mcp.yourdomain.com   # public HTTPS URL
export BLOGHUNCH_API_URL=https://api.bloghunch.com/api/v1
```

### 3. Start the server

```bash
npm start
# or: TRANSPORT=http node dist/index.js
```

Or with Docker:
```bash
docker build -t bloghunch-mcp .
docker run -p 3001:3001 \
  -e MCP_SERVER_URL=https://mcp.yourdomain.com \
  bloghunch-mcp
```

### 4. Expose via Nginx/Caddy

Point your domain (e.g., `mcp.yourdomain.com`) to the server on port 3001 with HTTPS.

**Nginx example:**
```nginx
server {
    server_name mcp.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

### 5. Connect in ChatGPT

1. Open ChatGPT → **Settings → Apps & Connectors → Advanced settings** → enable **Developer Mode**
2. Click **Create connector**
3. Enter name: `Bloghunch` and URL: `https://mcp.yourdomain.com`
4. Select **OAuth** as auth method
5. Click **Connect** → log in with your Bloghunch API key
6. Done ✅ — ChatGPT can now use all Bloghunch tools

---

## Local Development

```bash
# STDIO mode
npm run dev

# HTTP mode (test locally)
npm run dev:http
```

---

© 2026 Bloghunch — AI-native blogging platform.
