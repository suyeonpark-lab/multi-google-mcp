# multi-gmail-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing
**multiple Gmail accounts** from Claude Code — your own OAuth client, built in TypeScript.

> Runs locally. Each user brings their own Google Cloud OAuth client and their own
> account tokens. Nothing is shared or hosted.

## Tools
- `accounts` — list configured (authorized) accounts
- `authorize` — one-time browser OAuth for an account
- `search` — search a Gmail account (Gmail query syntax); pick which via `account`
- `ping` — health check

## Setup

### 1. Google Cloud OAuth client (one-time)
1. [console.cloud.google.com](https://console.cloud.google.com) → new project → enable **Gmail API**
2. OAuth consent screen: **External**; add your Gmail account(s) as **Test users**
3. Credentials → **OAuth client ID** → **Desktop app** → **Download JSON**
4. Save it as `~/.gmail-mcp/credentials.json`

### 2. Build
```bash
pnpm install
pnpm build
```

### 3. Authorize each account
```bash
pnpm run auth <account>      # e.g. pnpm run auth personal
```
Opens a browser; pick that Google account and grant access. The token is saved to
`~/.gmail-mcp/<account>/token.json`. (`credentials.json` is shared across accounts.)

## Use in Claude Code
Register once — use an **absolute** node path (fnm/nvm's node isn't on the spawn PATH):
```bash
claude mcp add multi-gmail-mcp -s user -- /abs/path/to/node /abs/path/to/multi-gmail-mcp/dist/index.js
```
Then, in a new session: *"multi-gmail-mcp에서 personal 안 읽은 메일 찾아줘"*

## Roadmap
1. ✅ Server skeleton + `ping`
2. ✅ Gmail OAuth + `search`
3. ⬜ `label` / `trash` / `filter` tools
4. ✅ Multi-account (`account` arg + `authorize` tool)

## Scopes
Requests `gmail.modify` (read + labels + move-to-trash; not permanent delete or send).
Adding `filter` creation will need `gmail.settings.basic` (re-auth).
