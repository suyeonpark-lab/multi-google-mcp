// multi-gmail-mcp — MCP server for managing multiple Gmail accounts.
//
// One server, many accounts. Tools take an optional `account`; `accounts` lists
// what's configured. Tokens live in ~/.gmail-mcp/<account>/token.json.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gmail_v1 } from "googleapis";
import { listAccounts, authorizeInteractive } from "./auth.js";
import { getGmail, resolveLabelIds } from "./gmail.js";

const server = new McpServer({ name: "multi-gmail-mcp", version: "0.4.0" });

// Reusable "which account?" argument.
const accountArg = z
  .string()
  .optional()
  .describe("Which Gmail account (e.g. 'personal'). Omit if only one is configured.");

// Turn an error into an MCP error result.
function fail(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text }], isError: true };
}

// --- ping ---
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

// --- accounts ---
server.registerTool(
  "accounts",
  {
    title: "List Gmail accounts",
    description:
      "List the accounts configured in this server (those authorized with a saved token). " +
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

// --- authorize ---
server.registerTool(
  "authorize",
  {
    title: "Authorize a Gmail account",
    description:
      "Run the one-time OAuth flow for an account: opens a browser, you pick that " +
      "Google account and grant access, and a token is saved. " +
      "Requires ~/.gmail-mcp/credentials.json (your Google Cloud OAuth client). " +
      "Only works where a browser can open (local desktop) and blocks until you finish consent.",
    inputSchema: {
      account: z.string().describe("A name for this account, e.g. 'personal' or 'main'"),
    },
  },
  async ({ account }) => {
    try {
      await authorizeInteractive(account);
      return { content: [{ type: "text", text: `✓ Authorized "${account}".` }] };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- search ---
server.registerTool(
  "search",
  {
    title: "Search Gmail",
    description:
      "Search an account using Gmail query syntax " +
      '(e.g. "from:foo is:unread", "category:promotions older_than:1y"). ' +
      "Returns date, sender, subject, snippet, and ids (use the thread id with label/trash).",
    inputSchema: {
      query: z
        .string()
        .describe('Gmail query, e.g. "from:foo is:unread newer_than:7d"'),
      account: accountArg,
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
      const gmail = await getGmail(account);
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
      return fail(err);
    }
  }
);

// --- list_labels ---
server.registerTool(
  "list_labels",
  {
    title: "List labels",
    description: "List an account's labels (name, id, type). Useful before labeling.",
    inputSchema: { account: accountArg },
  },
  async ({ account }) => {
    try {
      const gmail = await getGmail(account);
      const res = await gmail.users.labels.list({ userId: "me" });
      const labels = (res.data.labels ?? [])
        .map((l) => `• ${l.name}  [${l.id}]  (${l.type})`)
        .join("\n");
      return { content: [{ type: "text", text: labels || "No labels." }] };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- create_label ---
server.registerTool(
  "create_label",
  {
    title: "Create label",
    description: "Create a new label. Nested labels use '/', e.g. '보관/금융'.",
    inputSchema: {
      account: accountArg,
      name: z.string().describe("Label name, e.g. '보관/금융'"),
    },
  },
  async ({ account, name }) => {
    try {
      const gmail = await getGmail(account);
      const res = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      return {
        content: [{ type: "text", text: `Created label "${res.data.name}" [${res.data.id}]` }],
      };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- label (add/remove labels on a thread) ---
server.registerTool(
  "label",
  {
    title: "Label a thread",
    description:
      "Add and/or remove labels on a thread (use the thread id from search results). " +
      "Labels are given by NAME; system labels INBOX/UNREAD/STARRED/IMPORTANT also work. " +
      "Removing INBOX = archive.",
    inputSchema: {
      account: accountArg,
      threadId: z.string().describe("Thread id (the [thread:...] value from search)"),
      add: z.array(z.string()).optional().describe("Label names to add"),
      remove: z.array(z.string()).optional().describe("Label names to remove"),
    },
  },
  async ({ account, threadId, add, remove }) => {
    try {
      const gmail = await getGmail(account);
      const addLabelIds = add?.length ? await resolveLabelIds(gmail, add) : undefined;
      const removeLabelIds = remove?.length
        ? await resolveLabelIds(gmail, remove)
        : undefined;
      if (!addLabelIds && !removeLabelIds) {
        throw new Error("Provide 'add' and/or 'remove' label names.");
      }
      await gmail.users.threads.modify({
        userId: "me",
        id: threadId,
        requestBody: { addLabelIds, removeLabelIds },
      });
      return {
        content: [
          {
            type: "text",
            text: `Updated thread ${threadId}: +[${(add ?? []).join(", ")}] -[${(remove ?? []).join(", ")}]`,
          },
        ],
      };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- trash ---
server.registerTool(
  "trash",
  {
    title: "Trash a thread",
    description:
      "Move a thread to Trash (recoverable for 30 days). Use the thread id from search.",
    inputSchema: {
      account: accountArg,
      threadId: z.string().describe("Thread id"),
    },
  },
  async ({ account, threadId }) => {
    try {
      const gmail = await getGmail(account);
      await gmail.users.threads.trash({ userId: "me", id: threadId });
      return { content: [{ type: "text", text: `Trashed thread ${threadId}.` }] };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- create_filter (needs gmail.settings.basic; re-auth if you get a scope error) ---
server.registerTool(
  "create_filter",
  {
    title: "Create a filter",
    description:
      "Create a Gmail filter: match incoming mail by criteria, then apply actions. " +
      "Needs the gmail.settings.basic scope — if you get a permission error, re-run authorize. " +
      "Give at least one criterion and one action.",
    inputSchema: {
      account: accountArg,
      from: z.string().optional().describe("Match sender, e.g. 'news@x.com' or a domain"),
      to: z.string().optional().describe("Match recipient"),
      subject: z.string().optional().describe("Match subject"),
      query: z.string().optional().describe("Free Gmail query (hasTheWord), e.g. 'unsubscribe'"),
      addLabel: z.string().optional().describe("Label NAME to apply"),
      archive: z.boolean().optional().describe("Skip the inbox (remove INBOX)"),
      markRead: z.boolean().optional().describe("Mark as read (remove UNREAD)"),
      trash: z.boolean().optional().describe("Send straight to Trash"),
    },
  },
  async ({ account, from, to, subject, query, addLabel, archive, markRead, trash }) => {
    try {
      const gmail = await getGmail(account);
      const criteria: gmail_v1.Schema$FilterCriteria = {};
      if (from) criteria.from = from;
      if (to) criteria.to = to;
      if (subject) criteria.subject = subject;
      if (query) criteria.query = query;
      if (Object.keys(criteria).length === 0) {
        throw new Error("Provide at least one criterion: from / to / subject / query.");
      }
      const addLabelIds: string[] = [];
      const removeLabelIds: string[] = [];
      if (addLabel) addLabelIds.push(...(await resolveLabelIds(gmail, [addLabel])));
      if (trash) addLabelIds.push("TRASH");
      if (archive) removeLabelIds.push("INBOX");
      if (markRead) removeLabelIds.push("UNREAD");
      if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
        throw new Error("Provide at least one action: addLabel / archive / markRead / trash.");
      }
      const action: gmail_v1.Schema$FilterAction = {};
      if (addLabelIds.length) action.addLabelIds = addLabelIds;
      if (removeLabelIds.length) action.removeLabelIds = removeLabelIds;
      const res = await gmail.users.settings.filters.create({
        userId: "me",
        requestBody: { criteria, action },
      });
      return { content: [{ type: "text", text: `Created filter ${res.data.id}.` }] };
    } catch (err) {
      return fail(err);
    }
  }
);

// --- list_filters (needs gmail.settings.basic) ---
server.registerTool(
  "list_filters",
  {
    title: "List filters",
    description: "List the account's Gmail filters. Needs the gmail.settings.basic scope.",
    inputSchema: { account: accountArg },
  },
  async ({ account }) => {
    try {
      const gmail = await getGmail(account);
      const res = await gmail.users.settings.filters.list({ userId: "me" });
      const filters = res.data.filter ?? [];
      const text = filters.length
        ? filters
            .map(
              (f) =>
                `• ${f.id}\n  criteria: ${JSON.stringify(f.criteria)}\n  action: ${JSON.stringify(f.action)}`
            )
            .join("\n\n")
        : "No filters.";
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return fail(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("multi-gmail-mcp running (stdio)");
