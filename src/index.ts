// multi-google-mcp — MCP server for Gmail + Calendar + Drive across multiple Google accounts.
//
// One server, many accounts. Tools take an `account`; read-only tools accept "all".
// Tokens live in ~/.google-mcp/<account>/token.json.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listAccounts, authorizeInteractive, checkAccount } from "./auth.js";
import { ok, fail, RO, WRITE } from "./google.js";
import { registerGmailTools } from "./tools/gmail.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerDriveTools } from "./tools/drive.js";

const server = new McpServer({ name: "multi-google-mcp", version: "1.0.0" });

server.registerTool(
  "ping",
  {
    title: "Ping",
    annotations: RO,
    description: "Health check — returns 'pong'.",
    inputSchema: { message: z.string().optional().describe("Optional text to echo back") },
  },
  async ({ message }) => ok(`pong${message ? `: ${message}` : ""}`)
);

server.registerTool(
  "accounts",
  {
    title: "List Google accounts",
    annotations: RO,
    description:
      "List the accounts configured in this server (those with a saved token). " +
      "check=true also verifies each token (expiry, scopes) — run this first when a tool fails with invalid_grant.",
    inputSchema: { check: z.boolean().optional().describe("Verify each token against Google") },
  },
  async ({ check }) => {
    const accts = await listAccounts();
    if (!accts.length) return ok("No accounts configured yet. Run `pnpm run auth <account>`.");
    if (!check) return ok(`Configured accounts:\n${accts.map((a) => `• ${a}`).join("\n")}`);
    const rows = await Promise.all(
      accts.map(async (a) => {
        const r = await checkAccount(a);
        return `• ${a}  ${r.ok ? "✓" : "✗"} ${r.detail}`;
      })
    );
    return ok(`Account health:\n${rows.join("\n")}`);
  }
);

server.registerTool(
  "authorize",
  {
    title: "Authorize a Google account",
    annotations: WRITE,
    description:
      "Run the OAuth flow for an account: opens a browser, you pick that Google account and grant " +
      "Gmail + Calendar + Drive access, and a token is saved. force=true re-consents an existing account " +
      "(after invalid_grant or a scope change). Needs ~/.google-mcp/credentials.json and a local browser; blocks until consent finishes.",
    inputSchema: {
      account: z.string().describe("A name for this account, e.g. 'personal'"),
      force: z.boolean().optional().describe("Re-authorize even if a token exists"),
      email: z.string().optional().describe("Google email — preselects the account in the consent screen; remembered"),
    },
  },
  async ({ account, force, email }) => {
    try {
      const r = await authorizeInteractive(account, { force, email });
      return ok(r === "already" ? `"${account}" already authorized. Use force=true to re-consent.` : `✓ Authorized "${account}".`);
    } catch (err) {
      return fail(err);
    }
  }
);

registerGmailTools(server);
registerCalendarTools(server);
registerDriveTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("multi-google-mcp running (stdio)");
