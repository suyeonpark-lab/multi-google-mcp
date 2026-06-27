# multi-gmail-mcp

> 🇰🇷 한국어: [README.md](./README.md)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing
**multiple Gmail accounts** from Claude Code — your own OAuth client, built in TypeScript.

> Runs locally. Each user brings their own Google Cloud OAuth client and their own
> account tokens. Nothing is shared or hosted.

## Tools
| tool | what it does |
| --- | --- |
| `accounts` | list configured (authorized) accounts |
| `authorize` | one-time browser OAuth for an account |
| `search` | search an account (Gmail query syntax) |
| `list_labels` | list an account's labels |
| `create_label` | create a label (nested with `/`, e.g. `보관/금융`) |
| `label` | add/remove labels on a thread (by name; removing `INBOX` = archive) |
| `trash` | move a thread to Trash |
| `create_filter` | create a Gmail filter (needs `gmail.settings.basic`) |
| `list_filters` | list filters |
| `ping` | health check |

Every tool takes an optional `account`. With one account configured it is auto-selected;
with several you name it (or omit to get the list).

## How it works

**MCP basics.** An MCP server is a small program that speaks the Model Context Protocol
(JSON-RPC) over stdin/stdout. Claude Code launches it as a subprocess, asks for its tools
(`tools/list`), then calls them (`tools/call`). This server uses the official
`@modelcontextprotocol/sdk`: you register tools, the SDK handles the wire protocol.

**Layers.**
```
Claude Code ──(JSON-RPC over stdio)──▶ src/index.ts   (registers the tools)
                                            │
                                            ▼
                                       src/gmail.ts    (getGmail + label helpers)
                                            │
                                            ▼
                                       src/auth.ts     (per-account OAuth tokens)
                                            │
                                            ▼
                                       Gmail API (googleapis)
```

**Auth (OAuth 2.0).** Your Google Cloud project provides an OAuth *client*
(`credentials.json`). `pnpm run auth <account>` opens a browser; you grant access; the
resulting *refresh token* is saved to `~/.gmail-mcp/<account>/token.json`. At runtime the
server loads that token and auto-refreshes short-lived access tokens — no browser needed.

**Multi-account.** One server, many accounts. Each account is just a token folder; tools
take an `account` argument to pick one. `credentials.json` (the app identity) is shared;
only the token differs per account.

**Secrets.** `credentials.json` and `token.json` live under `~/.gmail-mcp/` (outside the
repo) and are gitignored — nothing sensitive is committed.

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
pnpm run auth <account>      # e.g. pnpm run auth myaccount
```

## Use in Claude Code
Register once — use an **absolute** node path (fnm/nvm's node isn't on the spawn PATH):
```bash
claude mcp add multi-gmail-mcp -s user -- /abs/path/to/node /abs/path/to/multi-gmail-mcp/dist/index.js
```
Then, in a new session: *"search myaccount for unread mail"*.

## Roadmap
1. ✅ Server skeleton + `ping`
2. ✅ Gmail OAuth + `search`
3. ✅ `label` / `trash` / `filter` tools
4. ✅ Multi-account (`account` arg + `authorize`)

## Scopes
`gmail.modify` (read + labels + move-to-trash) and `gmail.settings.basic` (filters).
A token authorized before a scope was added must re-auth: delete its token folder, then
`pnpm run auth <account>`.
