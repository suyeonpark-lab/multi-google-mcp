// auth.ts — Google OAuth for the Gmail MCP server.
//
// Two entry points:
//   authorizeInteractive() — opens a browser for one-time consent, saves a token.
//                            Used by `pnpm run auth`.
//   getAuthClient()        — loads the saved token (no browser). Used by the server.
//
// Secrets live in ~/.gmail-mcp/ (gitignored). Paths are overridable via env vars
// so we can support multiple accounts later (one token file per account).

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google, Auth } from "googleapis";

// Use the OAuth2Client type that `googleapis` ITSELF uses, so it lines up with
// google.gmail({ auth }). Importing it from a separately-versioned
// google-auth-library caused a "two different OAuth2Client" type clash.
type AuthClient = Auth.OAuth2Client;

// gmail.modify = read + write labels + move-to-trash (NOT permanent delete, NOT send).
// Covers our near-term tools (search, label, trash). Filters need an extra scope later.
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const CONFIG_DIR =
  process.env.GMAIL_MCP_DIR ?? path.join(os.homedir(), ".gmail-mcp");
const CREDENTIALS_PATH =
  process.env.GMAIL_MCP_CREDENTIALS ?? path.join(CONFIG_DIR, "credentials.json");
const TOKEN_PATH =
  process.env.GMAIL_MCP_TOKEN ?? path.join(CONFIG_DIR, "token.json");

// Load a previously-saved token (an "authorized_user" JSON). null if none yet.
async function loadSavedCredentialsIfExist(): Promise<AuthClient | null> {
  try {
    const content = await fs.readFile(TOKEN_PATH, "utf-8");
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials) as unknown as AuthClient;
  } catch {
    return null; // no token file (or unreadable) → treat as "not authorized"
  }
}

// Write token.json from the OAuth client keyfile + the new refresh token.
async function saveToken(refreshToken: string): Promise<void> {
  const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
  const keys = JSON.parse(content);
  const key = keys.installed ?? keys.web; // desktop OAuth clients use "installed"
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: refreshToken,
  });
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(TOKEN_PATH, payload);
}

// INTERACTIVE: run once via `pnpm run auth`. Opens a browser for consent.
export async function authorizeInteractive(): Promise<void> {
  if (await loadSavedCredentialsIfExist()) return; // already authorized
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  // We only need the refresh token (a string) — avoids passing a client of a
  // possibly different google-auth-library version across module boundaries.
  const refreshToken = client.credentials.refresh_token;
  if (refreshToken) await saveToken(refreshToken);
}

// NON-INTERACTIVE: used by the MCP server. Loads the saved token only.
export async function getAuthClient(): Promise<AuthClient> {
  const client = await loadSavedCredentialsIfExist();
  if (!client) {
    throw new Error(
      "Not authorized yet. Run `pnpm run auth` once to grant Gmail access."
    );
  }
  return client;
}
