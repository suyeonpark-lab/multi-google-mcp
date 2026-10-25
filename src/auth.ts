// auth.ts — Google OAuth, multi-account.
//
// Layout under ~/.google-mcp/ (gitignored):
//   credentials.json          ← shared OAuth client (the app identity)
//   <account>/token.json      ← per-account refresh token
//   <account>/meta.json       ← optional { email } for login_hint
//
// One MCP server handles many accounts; the account is chosen per tool call.

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { google, Auth } from "googleapis";

// Use googleapis' own OAuth2Client type so it matches google.gmail({ auth }).
export type AuthClient = Auth.OAuth2Client;

// One consent covers Gmail + Calendar + Drive. Adding a scope later means
// re-authorizing every account (`pnpm run auth <account> --force`).
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // read + labels + trash
  "https://www.googleapis.com/auth/gmail.settings.basic", // create/list filters
  "https://www.googleapis.com/auth/calendar.readonly", // list calendars
  "https://www.googleapis.com/auth/calendar.events", // events read/write (not calendar settings/ACLs)
  "https://www.googleapis.com/auth/drive", // files (read/write, all files)
];

export const CONFIG_DIR =
  process.env.GOOGLE_MCP_DIR ?? path.join(os.homedir(), ".google-mcp");
const CREDENTIALS_PATH =
  process.env.GOOGLE_MCP_CREDENTIALS ?? path.join(CONFIG_DIR, "credentials.json");

function tokenPath(account: string): string {
  return path.join(CONFIG_DIR, account, "token.json");
}

// Accounts that have a saved token (i.e. are authorized).
export async function listAccounts(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CONFIG_DIR, { withFileTypes: true });
    const accounts: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        await fs.access(tokenPath(e.name));
        accounts.push(e.name);
      } catch {
        // no token in this dir → not an authorized account
      }
    }
    return accounts.sort();
  } catch {
    return [];
  }
}

async function loadToken(account: string): Promise<AuthClient | null> {
  try {
    const content = await fs.readFile(tokenPath(account), "utf-8");
    return google.auth.fromJSON(JSON.parse(content)) as unknown as AuthClient;
  } catch {
    return null;
  }
}

async function saveToken(account: string, refreshToken: string): Promise<void> {
  const keys = JSON.parse(await fs.readFile(CREDENTIALS_PATH, "utf-8"));
  const key = keys.installed ?? keys.web; // desktop OAuth clients use "installed"
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: refreshToken,
    scopes: SCOPES,
  });
  const dir = path.join(CONFIG_DIR, account);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, "token.json"), payload, { mode: 0o600 });
  await fs.chmod(path.join(dir, "token.json"), 0o600); // writeFile mode is ignored if the file existed
}

// Per-account metadata next to the token (not secret): the Google email, used
// as login_hint so re-auth skips the account chooser.
function metaPath(account: string): string {
  return path.join(CONFIG_DIR, account, "meta.json");
}
export async function readMeta(account: string): Promise<{ email?: string }> {
  try {
    return JSON.parse(await fs.readFile(metaPath(account), "utf-8"));
  } catch {
    return {};
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
  child.on("error", () => console.error(`Open this URL in a browser:\n${url}`));
  child.unref();
}

// INTERACTIVE: `pnpm run auth <account> [--force] [--email x@gmail.com]`.
// Own loopback flow (instead of @google-cloud/local-auth) so we can send
// prompt=consent — without it Google returns NO refresh token on re-consent —
// and login_hint, which preselects the account in Google's chooser.
export async function authorizeInteractive(
  account: string,
  opts: { force?: boolean; email?: string } = {}
): Promise<"authorized" | "already"> {
  if (!opts.force && (await loadToken(account))) return "already";
  const keys = JSON.parse(await fs.readFile(CREDENTIALS_PATH, "utf-8"));
  const key = keys.installed ?? keys.web;
  const email = opts.email ?? (await readMeta(account)).email;

  // Desktop OAuth clients accept any loopback port; bind first, then build the URL.
  const server = http.createServer();
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = new google.auth.OAuth2(key.client_id, key.client_secret, redirectUri);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    login_hint: email,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for consent (5 min).")), 5 * 60_000);
    server.on("request", (req, resp) => {
      const u = new URL(req.url ?? "/", redirectUri);
      if (u.pathname !== "/oauth2callback") { resp.writeHead(404).end(); return; }
      const err = u.searchParams.get("error");
      const c = u.searchParams.get("code");
      resp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      resp.end(err ? `<h2>Authorization failed: ${err}</h2>` : `<h2>✓ "${account}" authorized — you can close this tab.</h2>`);
      clearTimeout(timer);
      err || !c ? reject(new Error(`Consent denied: ${err ?? "no code"}`)) : resolve(c);
    });
    console.error(`Opening browser for "${account}"${email ? ` (${email})` : ""}…`);
    openBrowser(url);
  }).finally(() => server.close());

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google returned no refresh token. Revoke the app at myaccount.google.com/permissions and retry.");
  }
  await saveToken(account, tokens.refresh_token);
  if (opts.email) await fs.writeFile(metaPath(account), JSON.stringify({ email: opts.email }), { mode: 0o600 });
  return "authorized";
}

// Health check: try to mint an access token. Catches the test-mode 7-day
// `invalid_grant` expiry and missing scopes before a real tool call fails.
export async function checkAccount(
  account: string
): Promise<{ ok: boolean; detail: string }> {
  const client = await loadToken(account);
  if (!client) return { ok: false, detail: "no token" };
  try {
    const { token } = await client.getAccessToken();
    if (!token) return { ok: false, detail: "no access token" };
    const info = await client.getTokenInfo(token);
    const granted = new Set(info.scopes ?? []);
    const missing = SCOPES.filter((s) => !granted.has(s)).map((s) =>
      s.replace("https://www.googleapis.com/auth/", "")
    );
    return missing.length
      ? { ok: false, detail: `missing scopes: ${missing.join(", ")} → re-auth with --force` }
      : { ok: true, detail: info.email ?? "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      detail: msg.includes("invalid_grant")
        ? "invalid_grant (token expired/revoked) → `pnpm run auth " + account + " --force`"
        : msg,
    };
  }
}

// SERVER: resolve which single account to use.
//   explicit account            → use it (must be authorized)
//   omitted + exactly 1 account → use that one
//   omitted + 0 or many         → throw a helpful message
export async function getAuthClient(account?: string): Promise<AuthClient> {
  const available = await listAccounts();
  const chosen =
    account ?? (available.length === 1 ? available[0] : undefined);
  if (!chosen) {
    if (available.length === 0) {
      throw new Error(
        "No accounts authorized yet. Run `pnpm run auth <account>` first."
      );
    }
    throw new Error(
      `Multiple accounts available: ${available.join(", ")}. Specify one via the "account" argument (or "all" for read-only tools).`
    );
  }
  if (chosen === "all") {
    throw new Error('"all" is only valid for read-only tools. Specify one account.');
  }
  const client = await loadToken(chosen);
  if (!client) {
    throw new Error(
      `Account "${chosen}" is not authorized. Available: ${available.join(", ") || "(none)"}. Run \`pnpm run auth ${chosen}\`.`
    );
  }
  return client;
}

// Read-only tools accept account = "all" (fan out) or omitted (= all when several).
export async function resolveAccounts(account?: string): Promise<string[]> {
  const available = await listAccounts();
  if (available.length === 0) {
    throw new Error("No accounts authorized yet. Run `pnpm run auth <account>` first.");
  }
  if (!account || account === "all") return available;
  if (!available.includes(account)) {
    throw new Error(
      `Account "${account}" is not authorized. Available: ${available.join(", ")}.`
    );
  }
  return [account];
}
