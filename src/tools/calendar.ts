// tools/calendar.ts — Google Calendar tools (calendar_*).
// Times: "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:MM" (local in timeZone) or RFC3339.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { calendar_v3 } from "googleapis";
import {
  getCalendar, accountArg, accountOrAllArg, ok, fail, forEachAccount, DEFAULT_TZ, toRfc3339, DESTRUCTIVE, RO, WRITE,
} from "../google.js";

const tzArg = z.string().optional().describe(`IANA time zone (default ${DEFAULT_TZ})`);
const calendarIdArg = z.string().optional()
  .describe('Calendar id (default "primary"). See calendar_list for others.');

function fmtEvent(e: calendar_v3.Schema$Event): string {
  const start = e.start?.dateTime ?? e.start?.date ?? "?";
  const end = e.end?.dateTime ?? e.end?.date ?? "";
  const when = e.start?.date ? `${start} (all-day)` : `${start} → ${end}`;
  const parts = [`• ${when} | ${e.summary ?? "(no title)"}`];
  if (e.location) parts.push(`  📍 ${e.location}`);
  if (e.attendees?.length) parts.push(`  👥 ${e.attendees.map((a) => a.email).join(", ")}`);
  if (e.status === "cancelled") parts.push("  (cancelled)");
  parts.push(`  [id:${e.id}]`);
  return parts.join("\n");
}

// Build start/end objects for insert/patch.
function eventTime(value: string, tz: string): calendar_v3.Schema$EventDateTime {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: toRfc3339(value, tz), timeZone: tz };
}

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "calendar_list",
    {
      title: "List calendars",
      annotations: RO,
      description: "List calendars each account can see (id, name, access role, primary).",
      inputSchema: { account: accountOrAllArg },
    },
    async ({ account }) => {
      try {
        const text = await forEachAccount(account, async (acct) => {
          const cal = await getCalendar(acct);
          const items = (await cal.calendarList.list()).data.items ?? [];
          return items
            .map((c) => `• ${c.summary}${c.primary ? " (primary)" : ""}  [${c.id}]  ${c.accessRole}`)
            .join("\n") || "No calendars.";
        });
        return ok(text);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "calendar_events",
    {
      title: "List events (agenda)",
      annotations: RO,
      description:
        "List events in a time range, across all accounts by default — the unified agenda. " +
        "Defaults: from=now, to=+7 days, primary calendar. Optional free-text filter.",
      inputSchema: {
        account: accountOrAllArg,
        from: z.string().optional().describe('Range start: "YYYY-MM-DD" or RFC3339 (default now)'),
        to: z.string().optional().describe('Range end: "YYYY-MM-DD" (inclusive) or RFC3339 (default +7d)'),
        query: z.string().optional().describe("Free-text match on title/description/location"),
        calendarId: calendarIdArg,
        timeZone: tzArg,
        maxResults: z.number().int().min(1).max(100).optional().describe("Per account (default 30)"),
      },
    },
    async ({ account, from, to, query, calendarId, timeZone, maxResults }) => {
      try {
        const tz = timeZone ?? DEFAULT_TZ;
        const timeMin = from ? toRfc3339(from, tz) : new Date().toISOString();
        const timeMax = to
          ? toRfc3339(to, tz, true)
          : new Date(Date.now() + 7 * 86400_000).toISOString();
        const text = await forEachAccount(account, async (acct) => {
          const cal = await getCalendar(acct);
          const res = await cal.events.list({
            calendarId: calendarId ?? "primary",
            timeMin, timeMax, q: query, timeZone: tz,
            singleEvents: true, orderBy: "startTime", maxResults: maxResults ?? 30,
          });
          const items = res.data.items ?? [];
          return items.length ? items.map(fmtEvent).join("\n") : "No events.";
        });
        return ok(`Range ${timeMin} → ${timeMax} (${tz})\n\n${text}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "calendar_create_event",
    {
      title: "Create event",
      annotations: WRITE,
      description:
        'Create an event. start/end: "YYYY-MM-DD" for all-day (end is exclusive: a 1-day event has end = next day), ' +
        'or "YYYY-MM-DDTHH:MM" in timeZone. Attendees get an invitation only if sendUpdates=true.',
      inputSchema: {
        account: accountArg,
        calendarId: calendarIdArg,
        summary: z.string().describe("Title"),
        start: z.string().describe('"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"'),
        end: z.string().describe('"YYYY-MM-DD" (exclusive) or "YYYY-MM-DDTHH:MM"'),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(z.string()).optional().describe("Attendee emails"),
        timeZone: tzArg,
        sendUpdates: z.boolean().optional().describe("Email invitations to attendees (default false)"),
      },
    },
    async ({ account, calendarId, summary, start, end, description, location, attendees, timeZone, sendUpdates }) => {
      try {
        const tz = timeZone ?? DEFAULT_TZ;
        const cal = await getCalendar(account);
        const res = await cal.events.insert({
          calendarId: calendarId ?? "primary",
          sendUpdates: sendUpdates ? "all" : "none",
          requestBody: {
            summary, description, location,
            start: eventTime(start, tz), end: eventTime(end, tz),
            attendees: attendees?.map((email) => ({ email })),
          },
        });
        return ok(`Created:\n${fmtEvent(res.data)}\n${res.data.htmlLink ?? ""}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "calendar_update_event",
    {
      title: "Update event",
      annotations: WRITE,
      description: "Patch fields of an existing event (only the given fields change). Event id from calendar_events.",
      inputSchema: {
        account: accountArg,
        calendarId: calendarIdArg,
        eventId: z.string(),
        summary: z.string().optional(),
        start: z.string().optional().describe('"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"'),
        end: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        timeZone: tzArg,
      },
    },
    async ({ account, calendarId, eventId, summary, start, end, description, location, timeZone }) => {
      try {
        const tz = timeZone ?? DEFAULT_TZ;
        const body: calendar_v3.Schema$Event = {};
        if (summary !== undefined) body.summary = summary;
        if (description !== undefined) body.description = description;
        if (location !== undefined) body.location = location;
        if (start) body.start = eventTime(start, tz);
        if (end) body.end = eventTime(end, tz);
        if (Object.keys(body).length === 0) throw new Error("Nothing to update.");
        const cal = await getCalendar(account);
        const res = await cal.events.patch({ calendarId: calendarId ?? "primary", eventId, requestBody: body });
        return ok(`Updated:\n${fmtEvent(res.data)}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "calendar_delete_event",
    {
      title: "Delete event",
      annotations: DESTRUCTIVE,
      description: "Delete an event. Requires confirm=true (not recoverable from the API).",
      inputSchema: {
        account: accountArg,
        calendarId: calendarIdArg,
        eventId: z.string(),
        confirm: z.boolean().optional().describe("Must be true to delete"),
      },
    },
    async ({ account, calendarId, eventId, confirm }) => {
      try {
        if (!confirm) return fail(`Refused: deleting event ${eventId} needs confirm=true.`);
        const cal = await getCalendar(account);
        await cal.events.delete({ calendarId: calendarId ?? "primary", eventId });
        return ok(`Deleted event ${eventId}.`);
      } catch (err) {
        return fail(err);
      }
    }
  );
}
