# multi-google-mcp

> 🇰🇷 한국어: [README.md](./README.md)

An [MCP](https://modelcontextprotocol.io) server for [Claude Code](https://claude.com/claude-code) that
manages **Gmail · Calendar · Drive** across **multiple Google accounts** — built from scratch in TypeScript,
using your own OAuth client.

> Runs locally. Everyone uses **their own Google Cloud OAuth client** and **their own account tokens**.
> Nothing shared or hosted.

## Tools
| Area | Tool | What it does |
| --- | --- | --- |
| Common | `accounts` | List accounts; `check=true` verifies each token (expiry, scopes) |
| | `authorize` | Browser OAuth for an account; `force=true` re-consents |
| | `ping` | Health check |
| Gmail | `gmail_search` ★ | Search with Gmail query syntax |
| | `gmail_list_labels` ★ / `gmail_create_label` | List / create labels (nest with `/`) |
| | `gmail_label` / `gmail_trash` | Add/remove labels on a thread (by name; removing `INBOX` = archive) / trash |
| | `gmail_list_filters` ★ / `gmail_create_filter` | List / create filters |
| | `gmail_batch` | Bulk label/archive/trash everything matching a query (preview-first; trash needs `confirmTrash`) |
| Calendar | `calendar_list` ★ | List calendars |
| | `calendar_events` ★ | Events in a range — **unified agenda across accounts** (default now → +7d) |
| | `calendar_create_event` / `calendar_update_event` | Create / patch an event |
| | `calendar_delete_event` | Delete (`confirm=true`) |
| Drive | `drive_search` ★ / `drive_recent` ★ | Search name/content (or raw q) / recently modified |
| | `drive_get` / `drive_read` | Metadata / content (Docs → text, Sheets → CSV) |
| | `drive_create` / `drive_update` | Create folder or text file (optionally as a Google Doc) / rename, move, replace content |
| | `drive_trash` | Trash (`confirm=true`) |

Every tool takes `account`. Read-only tools (★) accept `account="all"` (the default when several are
configured) and **query every account in parallel**, grouped by account. Write tools need one account.

Times: `"YYYY-MM-DD"` (all-day) or `"YYYY-MM-DDTHH:MM"` in `timeZone` (default `Asia/Seoul`;
override with env `GOOGLE_MCP_TZ`).

## How it works

**MCP basics.** An MCP server is a small program speaking JSON-RPC over stdin/stdout. Claude Code spawns it,
asks for `tools/list`, and issues `tools/call`. This server uses the official `@modelcontextprotocol/sdk`
— register tools, the SDK handles the protocol.

**Layers.**
```
Claude Code ──(JSON-RPC over stdio)──▶ src/index.ts            (common tools + module registration)
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
              src/tools/gmail.ts   src/tools/calendar.ts   src/tools/drive.ts
                       └────────────────────┼────────────────────┘
                                            ▼
                                       src/google.ts   (API clients · account fan-out · time helpers)
                                            ▼
                                       src/auth.ts     (per-account OAuth tokens · health check)
                                            ▼
                                   Gmail / Calendar / Drive API (googleapis)
```

**Auth (OAuth 2.0).** A Google Cloud project provides the OAuth *client* (`credentials.json`).
`pnpm run auth <account>` opens a browser for consent and saves the *refresh token* to
`~/.google-mcp/<account>/token.json`. At runtime that token mints short-lived access tokens — no browser.
One consent covers the Gmail, Calendar and Drive scopes.

**Multi-account.** One server, many accounts. Each account is just a token folder, selected per call via
`account`. `credentials.json` (the app identity) is shared; only tokens differ. `"all"` on read tools
calls every account in parallel and merges; one account failing doesn't hide the others.

**Secrets.** `credentials.json` and `token.json` live in `~/.google-mcp/` (outside the repo) and are gitignored.

## Setup

### 1. Google Cloud OAuth client (once)
1. [console.cloud.google.com](https://console.cloud.google.com) → new project → enable **Gmail API, Google Calendar API, Google Drive API**
2. OAuth consent screen: **External**; add your Google accounts as **test users**
3. Credentials → **OAuth client ID** → **Desktop app** → **Download JSON**
4. Save as `~/.google-mcp/credentials.json`
5. **Publish to production** — test-mode refresh tokens **expire after 7 days** (`invalid_grant`).
   Unverified apps keep showing the "unverified app" warning, but tokens become permanent.

### 2. Build
```bash
pnpm install
pnpm build
```

### 3. Authorize each account
```bash
pnpm run auth <account>            # e.g. pnpm run auth myaccount
pnpm run auth <account> --force    # re-consent after invalid_grant or added scopes
```

## Use from Claude Code
Register once — with an **absolute** node path (fnm/nvm node isn't on the spawn PATH):
```bash
claude mcp add multi-google-mcp -s user -- /abs/path/node /abs/path/multi-google-mcp/dist/index.js
```
Then in a new session: *"show this week's events across all accounts"*, *"search unread mail in myaccount"*,
*"find 'contract' in the work Drive"*.

## Scopes
`gmail.modify` (read + labels + trash) · `gmail.settings.basic` (filters) · `calendar.readonly`+`calendar.events` (no calendar settings/ACLs) · `drive` (all files — needed to search/edit existing files).
Adding a scope means re-authorizing every account with `--force`; `accounts check=true` reports missing scopes.
