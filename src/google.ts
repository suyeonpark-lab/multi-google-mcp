// google.ts — shared plumbing for every tool: authed API clients, the common
// `account` argument, error → MCP result, and multi-account fan-out.

import { google, gmail_v1, calendar_v3, drive_v3 } from "googleapis";
import { z } from "zod";
import { getAuthClient, resolveAccounts } from "./auth.js";

// googleapis@173 bundles mismatched google-auth-library copies; the OAuth2Client
// type doesn't nominally match the API constructors' param. Runtime is fine.
export async function getGmail(account?: string): Promise<gmail_v1.Gmail> {
  const auth = await getAuthClient(account);
  return google.gmail({ version: "v1", auth: auth as never });
}
export async function getCalendar(account?: string): Promise<calendar_v3.Calendar> {
  const auth = await getAuthClient(account);
  return google.calendar({ version: "v3", auth: auth as never });
}
export async function getDrive(account?: string): Promise<drive_v3.Drive> {
  const auth = await getAuthClient(account);
  return google.drive({ version: "v3", auth: auth as never });
}

// Write tools: exactly one account.
export const accountArg = z
  .string()
  .optional()
  .describe("Which account (see `accounts`). Omit if only one is configured.");

// Read-only tools: one account, or "all" (default when several are configured).
export const accountOrAllArg = z
  .string()
  .optional()
  .describe('Which account, or "all" to fan out across every account (default when several).');

// MCP tool annotations: hints for the client (Claude Code) about side effects.
export const RO = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

// Turn an error into an MCP error result.
export function fail(err: unknown): ToolResult {
  const text = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text }], isError: true };
}

// Run `fn` for each resolved account; one account's failure doesn't hide the
// others' results. Sections are headed by account name when >1.
export async function forEachAccount(
  account: string | undefined,
  fn: (account: string) => Promise<string>
): Promise<string> {
  const accounts = await resolveAccounts(account);
  const results = await Promise.all(
    accounts.map(async (a) => {
      try {
        return { a, text: await fn(a) };
      } catch (err) {
        return { a, text: `⚠ ${err instanceof Error ? err.message : String(err)}` };
      }
    })
  );
  if (results.length === 1) return results[0].text;
  return results.map(({ a, text }) => `## ${a}\n${text}`).join("\n\n");
}

export const DEFAULT_TZ = process.env.GOOGLE_MCP_TZ ?? "Asia/Seoul";

// UTC offset string ("+09:00") for a time zone at a given instant.
export function tzOffset(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT+09:00" | "GMT"
  const m = part?.match(/([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}

// Accept "YYYY-MM-DD", "YYYY-MM-DDTHH:MM[:SS]" (local in tz) or full RFC3339;
// return RFC3339 with an explicit offset (what the Calendar API requires).
export function toRfc3339(input: string, tz: string, endOfDay = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T${endOfDay ? "23:59:59" : "00:00:00"}${tzOffset(tz, new Date(input))}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input)) {
    const withSec = input.length === 16 ? `${input}:00` : input;
    return `${withSec}${tzOffset(tz, new Date(input))}`;
  }
  return input; // assume already RFC3339 (has Z or offset)
}
