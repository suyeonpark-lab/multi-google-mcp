// gmail-mcp — MCP server (multi-account: the account is a tool argument)
//
// One server, many accounts. Tools take an optional `account`; the `accounts`
// tool lists what's configured. Tokens live in ~/.gmail-mcp/<account>/token.json.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google } from "googleapis";
import { getAuthClient, listAccounts, authorizeInteractive } from "./auth.js";

const server = new McpServer({ name: "multi-gmail-mcp", version: "0.3.0" });

// --- ping: health check ---
server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Health check — returns 'pong'.",
    inputSchema: {
      message: z.string().optional().describe("Optional text to echo back"),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }],
  })
);

// --- accounts: list configured (authorized) accounts ---
server.registerTool(
  "accounts",
  {
    title: "List Gmail accounts",
    description:
      "List the Gmail accounts configured in this server (those authorized with a saved token). " +
      "Use a returned name as the 'account' argument for other tools.",
    inputSchema: {},
  },
  async () => {
    const accts = await listAccounts();
    const text = accts.length
      ? `Configured accounts:\n${accts.map((a) => `• ${a}`).join("\n")}`
      : "No accounts configured yet. Run `pnpm run auth <account>`.";
    return { content: [{ type: "text", text }] };
  }
);

// --- authorize: one-time browser OAuth for an account ---
server.registerTool(
  "authorize",
  {
    title: "Authorize a Gmail account",
    description:
      "Run the one-time OAuth flow for an account: opens a browser, you pick that " +
      "Google account and grant access, and a token is saved so search works. " +
      "Requires ~/.gmail-mcp/credentials.json (your Google Cloud OAuth client). " +
      "Only works where a browser can open (local desktop) and blocks until you finish consent.",
    inputSchema: {
      account: z
        .string()
        .describe("A name for this account, e.g. 'personal' or 'main'"),
    },
  },
  async ({ account }) => {
    try {
      await authorizeInteractive(account);
      return {
        content: [
          { type: "text", text: `✓ Authorized "${account}". You can now search it.` },
        ],
      };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Authorization failed: ${text}` }],
        isError: true,
      };
    }
  }
);

// --- search: search one account's Gmail ---
server.registerTool(
  "search",
  {
    title: "Search Gmail",
    description:
      "Search a Gmail account using Gmail query syntax " +
      '(e.g. "from:foo is:unread", "category:promotions older_than:1y"). ' +
      "Returns date, sender, subject, snippet, and ids. " +
      "Choose the account via 'account' (use the 'accounts' tool to see options; " +
      "omit only if a single account is configured).",
    inputSchema: {
      query: z
        .string()
        .describe('Gmail query, e.g. "from:foo is:unread newer_than:7d"'),
      account: z
        .string()
        .optional()
        .describe("Which Gmail account (e.g. 'personal'). Omit if only one is configured."),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("How many messages to return (default 10, max 25)"),
    },
  },
  async ({ query, account, maxResults }) => {
    try {
      const auth = await getAuthClient(account);
      // googleapis@173 bundles mismatched google-auth-library copies, so the
      // OAuth2Client type doesn't nominally match google.gmail()'s param.
      // Runtime objects are compatible — assert the type at this one boundary.
      const gmail = google.gmail({ version: "v1", auth: auth as never });

      const list = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: maxResults ?? 10,
      });
      const messages = list.data.messages ?? [];
      if (messages.length === 0) {
        return { content: [{ type: "text", text: `No messages match: ${query}` }] };
      }

      const lines = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          });
          const headers = msg.data.payload?.headers ?? [];
          const h = (name: string) =>
            headers.find((x) => x.name === name)?.value ?? "";
          return [
            `• ${h("Date")} | ${h("From")}`,
            `  ${h("Subject")}`,
            `  ${msg.data.snippet ?? ""}`,
            `  [id:${m.id} thread:${m.threadId}]`,
          ].join("\n");
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${messages.length} message(s):\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Search failed: ${text}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("gmail-mcp running (stdio)");
