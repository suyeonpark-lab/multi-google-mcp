// gmail-mcp — MCP server
// Milestone 2: real Gmail search. The OAuth token is loaded (no browser) from
// ~/.gmail-mcp/token.json, which you create once with `pnpm run auth`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

const server = new McpServer({ name: "gmail-mcp", version: "0.2.0" });

// --- ping: health check (kept from Milestone 1) ---
server.registerTool(
  "ping",
  {
    title: "Ping",
    description:
      "Health check — returns 'pong'. Verifies the server is wired up.",
    inputSchema: {
      message: z.string().optional().describe("Optional text to echo back"),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }],
  })
);

// --- search: search the user's Gmail ---
server.registerTool(
  "search",
  {
    title: "Search Gmail",
    description:
      "Search the user's Gmail using Gmail query syntax " +
      '(e.g. "from:foo@bar.com is:unread", "category:promotions older_than:1y"). ' +
      "Returns date, sender, subject, snippet, and ids for each match.",
    inputSchema: {
      query: z
        .string()
        .describe('Gmail query, e.g. "from:foo is:unread newer_than:7d"'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("How many messages to return (default 10, max 25)"),
    },
  },
  async ({ query, maxResults }) => {
    try {
      const auth = await getAuthClient();
      // googleapis@173 bundles mismatched google-auth-library copies, so our
      // OAuth2Client type doesn't nominally match google.gmail()'s param type.
      // The runtime objects are compatible — assert the type at this one boundary.
      const gmail = google.gmail({ version: "v1", auth: auth as never });

      // Step 1: list matching message IDs (this call returns ids only).
      const list = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: maxResults ?? 10,
      });
      const messages = list.data.messages ?? [];
      if (messages.length === 0) {
        return { content: [{ type: "text", text: `No messages match: ${query}` }] };
      }

      // Step 2: fetch lightweight metadata per id (subject/from/date + snippet).
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
      // Return a friendly error to the model instead of crashing the server.
      const text = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Search failed: ${text}` }],
        isError: true,
      };
    }
  }
);

// Connect over stdio. Logs go to stderr (stdout is the protocol channel).
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("gmail-mcp running (stdio)");
