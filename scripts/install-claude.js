import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG_PATH = path.join(
  os.homedir(),
  'Library/Application Support/Claude/claude_desktop_config.json'
);

const SERVER_PATH = path.resolve('./dist/index.js');
const API_KEY = process.env.BLOGHUNCH_API_KEY;
const API_URL = process.env.BLOGHUNCH_API_URL || 'http://localhost:3332/api/v1';
const SUBDOMAIN = process.env.BLOGHUNCH_SUBDOMAIN || 'bloghunch';

async function install() {
  console.log('🚀 Installing Bloghunch MCP to Claude Desktop...');

  if (!fs.existsSync(SERVER_PATH)) {
    console.log('📦 Building server first...');
    execSync('npm run build');
  }

  if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  }

  let config = { mcpServers: {} };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {
      console.error('❌ Error reading existing config:', e.message);
    }
  }

  config.mcpServers = config.mcpServers || {};
  config.mcpServers.bloghunch = {
    command: 'node',
    args: [SERVER_PATH],
    env: {
      BLOGHUNCH_API_KEY: API_KEY || 'YOUR_API_KEY_HERE',
      BLOGHUNCH_API_URL: API_URL,
      BLOGHUNCH_SUBDOMAIN: SUBDOMAIN
    }
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('✅ Success! Bloghunch MCP added to Claude Desktop.');
  console.log('ℹ️ Path:', CONFIG_PATH);
  
  if (!API_KEY) {
    console.warn('⚠️  Warning: BLOGHUNCH_API_KEY not found in environment. Please update your config file manually.');
  }

  console.log('🔄 Please restart Claude Desktop to load the new tools.');
}

install().catch(console.error);
