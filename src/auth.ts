// auth.ts — Google OAuth, multi-account.
//
// Layout under ~/.gmail-mcp/ (gitignored):
//   credentials.json          ← shared OAuth client (the app identity)
//   <account>/token.json      ← per-account refresh token
//
// One MCP server handles many accounts; the account is chosen per tool call.

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
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
  process.env.GMAIL_MCP_DIR ?? path.join(os.homedir(), ".gmail-mcp");
const CREDENTIALS_PATH =
  process.env.GMAIL_MCP_CREDENTIALS ?? path.join(CONFIG_DIR, "credentials.json");

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

// INTERACTIVE: `pnpm run auth <account> [--force]`. Opens a browser for consent.
// `force` re-runs consent even if a token exists (expired token / new scopes).
export async function authorizeInteractive(
  account: string,
  force = false
): Promise<"authorized" | "already"> {
  if (!force && (await loadToken(account))) return "already";
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  const refreshToken = client.credentials.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "No refresh token returned by Google. Remove the account folder and try again."
    );
  }
  await saveToken(account, refreshToken);
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
