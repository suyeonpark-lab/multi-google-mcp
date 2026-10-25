// tools/drive.ts — Google Drive tools (drive_*).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drive_v3 } from "googleapis";
import { getDrive, accountArg, accountOrAllArg, ok, fail, forEachAccount, DESTRUCTIVE, RO, WRITE } from "../google.js";

const FIELDS = "id,name,mimeType,modifiedTime,size,owners(emailAddress),parents,webViewLink,trashed";
const LIST_FIELDS = `nextPageToken,files(${FIELDS})`;

const FOLDER = "application/vnd.google-apps.folder";
// Google-native docs can't be downloaded; they're exported to a plain format.
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
};
const MAX_CHARS = 60_000;

function shortMime(m?: string | null): string {
  if (!m) return "?";
  if (m === FOLDER) return "folder";
  if (m.startsWith("application/vnd.google-apps.")) return "g-" + m.slice("application/vnd.google-apps.".length);
  return m;
}

function fmtFile(f: drive_v3.Schema$File): string {
  const size = f.size ? ` ${(Number(f.size) / 1024).toFixed(0)}KB` : "";
  return [
    `• ${f.name}  (${shortMime(f.mimeType)}${size})  ${f.modifiedTime ?? ""}${f.trashed ? "  [TRASHED]" : ""}`,
    `  [id:${f.id}]${f.parents?.length ? ` parent:${f.parents[0]}` : ""}  ${f.webViewLink ?? ""}`,
  ].join("\n");
}

// Escape a value for Drive's q syntax (single-quoted strings).
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function registerDriveTools(server: McpServer): void {
  server.registerTool(
    "drive_search",
    {
      title: "Search Drive",
      annotations: RO,
      description:
        "Search files across accounts. `text` matches name or content; `query` is raw Drive q syntax " +
        "(e.g. \"mimeType='application/pdf' and modifiedTime > '2026-01-01'\"). Trashed files excluded.",
      inputSchema: {
        account: accountOrAllArg,
        text: z.string().optional().describe("Match in file name or full text"),
        query: z.string().optional().describe("Raw Drive query (ANDed with text)"),
        folderId: z.string().optional().describe("Restrict to direct children of this folder"),
        maxResults: z.number().int().min(1).max(100).optional().describe("Per account (default 20)"),
      },
    },
    async ({ account, text, query, folderId, maxResults }) => {
      try {
        const clauses = ["trashed = false"];
        if (text) clauses.push(`(name contains '${q(text)}' or fullText contains '${q(text)}')`);
        if (query) clauses.push(`(${query})`);
        if (folderId) clauses.push(`'${q(folderId)}' in parents`);
        const qs = clauses.join(" and ");
        const out = await forEachAccount(account, async (acct) => {
          const drive = await getDrive(acct);
          const res = await drive.files.list({
            q: qs, fields: LIST_FIELDS, pageSize: maxResults ?? 20,
            orderBy: "modifiedTime desc", includeItemsFromAllDrives: true, supportsAllDrives: true,
          });
          const files = res.data.files ?? [];
          return files.length ? files.map(fmtFile).join("\n") : "No files.";
        });
        return ok(`q: ${qs}\n\n${out}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_recent",
    {
      title: "Recent files",
      annotations: RO,
      description: "Most recently modified files per account (excluding trash).",
      inputSchema: {
        account: accountOrAllArg,
        maxResults: z.number().int().min(1).max(50).optional().describe("Per account (default 15)"),
      },
    },
    async ({ account, maxResults }) => {
      try {
        const out = await forEachAccount(account, async (acct) => {
          const drive = await getDrive(acct);
          const res = await drive.files.list({
            q: "trashed = false", fields: LIST_FIELDS, pageSize: maxResults ?? 15, orderBy: "modifiedTime desc",
          });
          const files = res.data.files ?? [];
          return files.length ? files.map(fmtFile).join("\n") : "No files.";
        });
        return ok(out);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_get",
    {
      title: "File metadata",
      annotations: RO,
      description: "Metadata for one file (name, type, size, parents, link, owners).",
      inputSchema: { account: accountArg, fileId: z.string() },
    },
    async ({ account, fileId }) => {
      try {
        const drive = await getDrive(account);
        const res = await drive.files.get({ fileId, fields: FIELDS + ",description,createdTime", supportsAllDrives: true });
        const f = res.data;
        return ok(`${fmtFile(f)}\n  owners: ${f.owners?.map((o) => o.emailAddress).join(", ")}\n  created: ${f.createdTime}${f.description ? `\n  description: ${f.description}` : ""}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_read",
    {
      title: "Read file content",
      annotations: RO,
      description:
        "Read a file as text. Google Docs → plain text, Sheets → CSV, Slides → text; " +
        `text/* and JSON files are downloaded. Binary files are refused (use the webViewLink). Truncated at ${MAX_CHARS} chars.`,
      inputSchema: { account: accountArg, fileId: z.string() },
    },
    async ({ account, fileId }) => {
      try {
        const drive = await getDrive(account);
        const meta = (await drive.files.get({ fileId, fields: "name,mimeType,size", supportsAllDrives: true })).data;
        const mime = meta.mimeType ?? "";
        let body: string;
        if (EXPORT_AS[mime]) {
          const res = await drive.files.export({ fileId, mimeType: EXPORT_AS[mime] }, { responseType: "text" });
          body = String(res.data);
        } else if (mime.startsWith("text/") || /json|xml|csv|markdown/.test(mime)) {
          const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
          body = String(res.data);
        } else {
          throw new Error(`"${meta.name}" is ${mime} (${meta.size ?? "?"} bytes) — not text. Open it via the webViewLink from drive_get.`);
        }
        const truncated = body.length > MAX_CHARS;
        return ok(`# ${meta.name} (${shortMime(mime)})\n\n${body.slice(0, MAX_CHARS)}${truncated ? "\n\n[... truncated]" : ""}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_create",
    {
      title: "Create file or folder",
      annotations: WRITE,
      description:
        "Create a folder, or a text file with the given content. mimeType defaults to text/plain " +
        "(use text/markdown, application/json, …). Set convertToDoc=true to create a Google Doc from the text.",
      inputSchema: {
        account: accountArg,
        name: z.string(),
        folder: z.boolean().optional().describe("Create a folder instead of a file"),
        content: z.string().optional().describe("File content (ignored for folders)"),
        mimeType: z.string().optional().describe("Content type of `content` (default text/plain)"),
        convertToDoc: z.boolean().optional().describe("Store as a Google Doc"),
        parentId: z.string().optional().describe("Parent folder id (default: My Drive root)"),
      },
    },
    async ({ account, name, folder, content, mimeType, convertToDoc, parentId }) => {
      try {
        const drive = await getDrive(account);
        const parents = parentId ? [parentId] : undefined;
        const res = folder
          ? await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents }, fields: FIELDS, supportsAllDrives: true })
          : await drive.files.create({
              requestBody: {
                name, parents,
                mimeType: convertToDoc ? "application/vnd.google-apps.document" : mimeType ?? "text/plain",
              },
              media: { mimeType: mimeType ?? "text/plain", body: content ?? "" },
              fields: FIELDS, supportsAllDrives: true,
            });
        return ok(`Created:\n${fmtFile(res.data)}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_update",
    {
      title: "Rename / move / overwrite",
      annotations: WRITE,
      description: "Rename a file, move it to another folder, and/or replace its text content.",
      inputSchema: {
        account: accountArg,
        fileId: z.string(),
        name: z.string().optional().describe("New name"),
        moveToFolderId: z.string().optional().describe("Destination folder id"),
        content: z.string().optional().describe("New text content (replaces the file body)"),
        mimeType: z.string().optional().describe("Content type of `content`"),
      },
    },
    async ({ account, fileId, name, moveToFolderId, content, mimeType }) => {
      try {
        if (name === undefined && !moveToFolderId && content === undefined) throw new Error("Nothing to update.");
        const drive = await getDrive(account);
        let addParents: string | undefined;
        let removeParents: string | undefined;
        if (moveToFolderId) {
          const cur = (await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true })).data;
          addParents = moveToFolderId;
          removeParents = cur.parents?.join(",");
        }
        const res = await drive.files.update({
          fileId, addParents, removeParents, fields: FIELDS, supportsAllDrives: true,
          requestBody: name !== undefined ? { name } : {},
          media: content !== undefined ? { mimeType: mimeType ?? "text/plain", body: content } : undefined,
        });
        return ok(`Updated:\n${fmtFile(res.data)}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "drive_trash",
    {
      title: "Trash a file",
      annotations: DESTRUCTIVE,
      description: "Move a file to Drive trash (auto-deleted after 30 days). Requires confirm=true.",
      inputSchema: {
        account: accountArg,
        fileId: z.string(),
        confirm: z.boolean().optional().describe("Must be true to trash"),
      },
    },
    async ({ account, fileId, confirm }) => {
      try {
        if (!confirm) return fail(`Refused: trashing ${fileId} needs confirm=true.`);
        const drive = await getDrive(account);
        const res = await drive.files.update({ fileId, requestBody: { trashed: true }, fields: "name", supportsAllDrives: true });
        return ok(`Trashed "${res.data.name}" [${fileId}].`);
      } catch (err) {
        return fail(err);
      }
    }
  );
}
