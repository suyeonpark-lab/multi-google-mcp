// auth.ts — Google OAuth, multi-account.
//
// Layout under ~/.gmail-mcp/ (gitignored):
//   credentials.json          ← shared OAuth client (the app identity)
//   <account>/token.json      ← per-account access token
//
// One MCP server handles many accounts; the account is chosen per tool call.

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google, Auth } from "googleapis";

// Use googleapis' own OAuth2Client type so it matches google.gmail({ auth }).
type AuthClient = Auth.OAuth2Client;

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const CONFIG_DIR =
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
        await fs.access(path.join(CONFIG_DIR, e.name, "token.json"));
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
  });
  const dir = path.join(CONFIG_DIR, account);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "token.json"), payload);
}

// INTERACTIVE: `pnpm run auth <account>`. Opens a browser for consent.
export async function authorizeInteractive(account: string): Promise<void> {
  if (await loadToken(account)) return; // already authorized
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
}

// SERVER: resolve which account to use.
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
      `Multiple accounts available: ${available.join(", ")}. Specify one via the "account" argument.`
    );
  }
  const client = await loadToken(chosen);
  if (!client) {
    throw new Error(
      `Account "${chosen}" is not authorized. Available: ${available.join(", ") || "(none)"}. Run \`pnpm run auth ${chosen}\`.`
    );
  }
  return client;
}
