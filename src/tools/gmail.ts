// tools/gmail.ts — Gmail tools (gmail_*). Labels are addressed by NAME.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gmail_v1 } from "googleapis";
import { getGmail, accountArg, accountOrAllArg, ok, fail, forEachAccount, DESTRUCTIVE, RO, WRITE } from "../google.js";

const SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "STARRED", "IMPORTANT", "TRASH", "SPAM", "SENT", "DRAFT", "CHAT",
]);

// Resolve label NAMES (or raw ids) to label ids. System labels (INBOX, UNREAD,
// TRASH, …) are accepted by name. Throws on an unknown user label.
async function resolveLabelIds(gmail: gmail_v1.Gmail, names: string[]): Promise<string[]> {
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels ?? [];
  const byName = new Map<string, string>();
  const ids = new Set<string>();
  for (const l of labels) {
    if (l.name && l.id) byName.set(l.name, l.id);
    if (l.id) ids.add(l.id);
  }
  return names.map((n) => {
    const up = n.toUpperCase();
    if (SYSTEM_LABELS.has(up)) return up;
    const byNameId = byName.get(n);
    if (byNameId) return byNameId;
    if (ids.has(n)) return n; // caller passed an id already
    throw new Error(`Unknown label: "${n}". Use gmail_list_labels to see available names.`);
  });
}

// Collect message ids matching a query, following pagination. Capped for safety
// so a broad query can't run away; `truncated` signals there were more.
async function collectMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
  cap = 2000
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 500, pageToken });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    if (ids.length >= cap) return { ids: ids.slice(0, cap), truncated: true };
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return { ids, truncated: false };
}

export function registerGmailTools(server: McpServer): void {
  server.registerTool(
    "gmail_search",
    {
      title: "Search Gmail",
      annotations: RO,
      description:
        "Search using Gmail query syntax " +
        '(e.g. "from:foo is:unread", "category:promotions older_than:1y"). ' +
        'Returns date, sender, subject, snippet, and ids (use the thread id with gmail_label/gmail_trash). account="all" searches every account.',
      inputSchema: {
        query: z.string().describe('Gmail query, e.g. "from:foo is:unread newer_than:7d"'),
        account: accountOrAllArg,
        maxResults: z.number().int().min(1).max(25).optional()
          .describe("How many messages per account (default 10, max 25)"),
      },
    },
    async ({ query, account, maxResults }) => {
      try {
        const text = await forEachAccount(account, async (acct) => {
          const gmail = await getGmail(acct);
          const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: maxResults ?? 10 });
          const messages = list.data.messages ?? [];
          if (messages.length === 0) return `No messages match: ${query}`;
          const lines = await Promise.all(
            messages.map(async (m) => {
              const msg = await gmail.users.messages.get({
                userId: "me", id: m.id!, format: "metadata", metadataHeaders: ["Subject", "From", "Date"],
              });
              const headers = msg.data.payload?.headers ?? [];
              const h = (name: string) => headers.find((x) => x.name === name)?.value ?? "";
              return [
                `• ${h("Date")} | ${h("From")}`,
                `  ${h("Subject")}`,
                `  ${msg.data.snippet ?? ""}`,
                `  [id:${m.id} thread:${m.threadId}]`,
              ].join("\n");
            })
          );
          return `Found ${messages.length} message(s):\n\n${lines.join("\n\n")}`;
        });
        return ok(text);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_list_labels",
    {
      title: "List labels",
      annotations: RO,
      description: "List labels (name, id, type). Useful before labeling.",
      inputSchema: { account: accountOrAllArg },
    },
    async ({ account }) => {
      try {
        const text = await forEachAccount(account, async (acct) => {
          const gmail = await getGmail(acct);
          const res = await gmail.users.labels.list({ userId: "me" });
          return (res.data.labels ?? []).map((l) => `• ${l.name}  [${l.id}]  (${l.type})`).join("\n") || "No labels.";
        });
        return ok(text);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_create_label",
    {
      title: "Create label",
      annotations: WRITE,
      description: "Create a new label. Nested labels use '/', e.g. '보관/금융'.",
      inputSchema: { account: accountArg, name: z.string().describe("Label name, e.g. '보관/금융'") },
    },
    async ({ account, name }) => {
      try {
        const gmail = await getGmail(account);
        const res = await gmail.users.labels.create({
          userId: "me",
          requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
        });
        return ok(`Created label "${res.data.name}" [${res.data.id}]`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_label",
    {
      title: "Label a thread",
      annotations: WRITE,
      description:
        "Add and/or remove labels on a thread (thread id from gmail_search). " +
        "Labels are given by NAME; system labels INBOX/UNREAD/STARRED/IMPORTANT also work. Removing INBOX = archive.",
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
        const removeLabelIds = remove?.length ? await resolveLabelIds(gmail, remove) : undefined;
        if (!addLabelIds && !removeLabelIds) throw new Error("Provide 'add' and/or 'remove' label names.");
        await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds, removeLabelIds } });
        return ok(`Updated thread ${threadId}: +[${(add ?? []).join(", ")}] -[${(remove ?? []).join(", ")}]`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_trash",
    {
      title: "Trash a thread",
      annotations: DESTRUCTIVE,
      description: "Move a thread to Trash (recoverable for 30 days). Use the thread id from gmail_search.",
      inputSchema: { account: accountArg, threadId: z.string().describe("Thread id") },
    },
    async ({ account, threadId }) => {
      try {
        const gmail = await getGmail(account);
        await gmail.users.threads.trash({ userId: "me", id: threadId });
        return ok(`Trashed thread ${threadId}.`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_create_filter",
    {
      title: "Create a filter",
      annotations: WRITE,
      description:
        "Create a Gmail filter: match incoming mail by criteria, then apply actions. " +
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
        if (Object.keys(criteria).length === 0) throw new Error("Provide at least one criterion: from / to / subject / query.");
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
        const res = await gmail.users.settings.filters.create({ userId: "me", requestBody: { criteria, action } });
        return ok(`Created filter ${res.data.id}.`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_list_filters",
    {
      title: "List filters",
      annotations: RO,
      description: "List Gmail filters (criteria + action).",
      inputSchema: { account: accountOrAllArg },
    },
    async ({ account }) => {
      try {
        const text = await forEachAccount(account, async (acct) => {
          const gmail = await getGmail(acct);
          const filters = (await gmail.users.settings.filters.list({ userId: "me" })).data.filter ?? [];
          return filters.length
            ? filters.map((f) => `• ${f.id}\n  criteria: ${JSON.stringify(f.criteria)}\n  action: ${JSON.stringify(f.action)}`).join("\n\n")
            : "No filters.";
        });
        return ok(text);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "gmail_batch",
    {
      title: "Bulk apply to a query",
      annotations: DESTRUCTIVE,
      description:
        "Apply an action to ALL messages matching a Gmail query (paginated, not capped at 25). " +
        "Actions: add/remove labels, archive (remove from inbox), or trash. **Previews by default** (apply=false): " +
        "returns the match count and planned action without changing anything — show this to the user first. " +
        "Re-run with apply=true to execute. **Trashing also requires confirmTrash=true.** " +
        "Prefer archive over trash when unsure.",
      inputSchema: {
        account: accountArg,
        query: z.string().describe('Gmail query, e.g. "from:costco.co.kr" or "category:promotions older_than:1y"'),
        addLabels: z.array(z.string()).optional().describe("Label names to add"),
        removeLabels: z.array(z.string()).optional().describe("Label names to remove"),
        archive: z.boolean().optional().describe("Remove from inbox (keep the mail)"),
        trash: z.boolean().optional().describe("Move to Trash (recoverable 30 days). Requires confirmTrash."),
        apply: z.boolean().optional().describe("false (default) = preview only; true = execute"),
        confirmTrash: z.boolean().optional().describe("Must be true to actually trash (final confirmation)"),
      },
    },
    async ({ account, query, addLabels, removeLabels, archive, trash, apply, confirmTrash }) => {
      try {
        const gmail = await getGmail(account);
        const addLabelIds: string[] = [];
        const removeLabelIds: string[] = [];
        if (addLabels?.length) addLabelIds.push(...(await resolveLabelIds(gmail, addLabels)));
        if (removeLabels?.length) removeLabelIds.push(...(await resolveLabelIds(gmail, removeLabels)));
        if (archive) removeLabelIds.push("INBOX");
        if (trash) addLabelIds.push("TRASH");
        if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
          throw new Error("Provide an action: addLabels / removeLabels / archive / trash.");
        }
        const planParts: string[] = [];
        if (addLabels?.length) planParts.push(`+[${addLabels.join(", ")}]`);
        if (removeLabels?.length) planParts.push(`-[${removeLabels.join(", ")}]`);
        if (archive) planParts.push("archive(-INBOX)");
        if (trash) planParts.push("TRASH");
        const plan = planParts.join(" ");

        const { ids, truncated } = await collectMessageIds(gmail, query);
        const head = `${ids.length}${truncated ? "+" : ""} message(s) match "${query}". Action: ${plan}.`;
        if (!apply) {
          return ok(`[PREVIEW — nothing changed] ${head}\nRe-run with apply=true${trash ? " and confirmTrash=true" : ""} to execute.`);
        }
        if (trash && !confirmTrash) {
          return { ...fail(`Refused: trashing ${ids.length} message(s) needs confirmTrash=true. ${head}`) };
        }
        if (ids.length === 0) return ok(`No messages match "${query}". Nothing to do.`);
        for (let i = 0; i < ids.length; i += 1000) { // batchModify max 1000 ids/call
          await gmail.users.messages.batchModify({
            userId: "me",
            requestBody: {
              ids: ids.slice(i, i + 1000),
              addLabelIds: addLabelIds.length ? addLabelIds : undefined,
              removeLabelIds: removeLabelIds.length ? removeLabelIds : undefined,
            },
          });
        }
        return ok(`Done. Applied ${plan} to ${ids.length} message(s)${truncated ? " (capped — run again for the rest)" : ""}.`);
      } catch (err) {
        return fail(err);
      }
    }
  );
}
