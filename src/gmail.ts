// gmail.ts — shared helpers for the Gmail tools.

import { google, gmail_v1 } from "googleapis";
import { getAuthClient } from "./auth.js";

// Build an authenticated Gmail client for an account.
export async function getGmail(account?: string): Promise<gmail_v1.Gmail> {
  const auth = await getAuthClient(account);
  // googleapis@173 bundles mismatched google-auth-library copies; the OAuth2Client
  // type doesn't nominally match google.gmail()'s param. Runtime is fine — assert here.
  return google.gmail({ version: "v1", auth: auth as never });
}

const SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "STARRED", "IMPORTANT", "TRASH", "SPAM", "SENT", "DRAFT", "CHAT",
]);

// Resolve label NAMES (or raw ids) to label ids. System labels (INBOX, UNREAD,
// TRASH, …) are accepted by name. Throws on an unknown user label.
export async function resolveLabelIds(
  gmail: gmail_v1.Gmail,
  names: string[]
): Promise<string[]> {
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
    throw new Error(`Unknown label: "${n}". Use list_labels to see available names.`);
  });
}

// Collect message ids matching a query, following pagination. Capped for safety
// so a broad query can't run away; `truncated` signals there were more.
export async function collectMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
  cap = 2000
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });
    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    if (ids.length >= cap) return { ids: ids.slice(0, cap), truncated: true };
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return { ids, truncated: false };
}
