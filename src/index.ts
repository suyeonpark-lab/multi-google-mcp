// gmail-mcp — minimal MCP server
// Milestone 1: prove the plumbing works (no Gmail yet).
//
// An MCP "server" is just a program that speaks the MCP protocol over
// stdin/stdout. Claude Code launches this as a subprocess and talks to it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1) Create the server. name/version are what show up in Claude's /mcp list.
const server = new McpServer({
  name: "gmail-mcp",
  version: "0.1.0",
});

// 2) Register a tool. Later these become search / label / trash, etc.
//    `inputSchema` uses zod to declare AND validate the arguments —
//    Claude only gets to call the tool with args that match this shape.
server.registerTool(
  "ping",
  {
    title: "Ping",
    description:
      "Health check — returns 'pong'. Use this to verify the server is wired up.",
    inputSchema: {
      message: z.string().optional().describe("Optional text to echo back"),
    },
  },
  // The handler receives the validated args and returns MCP "content".
  async ({ message }) => {
    return {
      content: [
        { type: "text", text: `pong${message ? `: ${message}` : ""}` },
      ],
    };
  }
);

// 3) Connect over stdio.
//    FOOTGUN: stdout carries the MCP protocol itself. If you console.log()
//    to stdout you corrupt the stream. All logging MUST go to stderr.
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("gmail-mcp running (stdio)"); // stderr = safe
