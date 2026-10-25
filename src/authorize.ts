// authorize.ts — OAuth setup per account.
//   pnpm run auth <account> [--force] [--email x@gmail.com]   one account
//   pnpm run auth --all [--force]                             re-auth every configured account
//   pnpm run auth --op "<1Password item>" [--section accounts] list-driven (idempotent)
//   pnpm run auth --list accounts.json | -                    same, from a JSON file / stdin
//   pnpm run auth                                             list-driven using ~/.google-mcp/config.json:
//     { "accounts": { "op": "<1Password item>", "section": "accounts" } }  or  { "accounts": { "file": "<path>" } }
//
// List-driven mode reads [{ "name", "email" }, ...] — from a 1Password item's
// custom section (label = name, value = email) or a JSON file — records each
// expected email in meta.json, health-checks the token, and opens the browser
// ONLY for accounts that are missing, expired, under-scoped, or belong to a
// different Google account than the list says. Accounts on disk but not in the
// list are reported, never deleted.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorizeInteractive, listAccounts, listAccountDirs, checkAccount, writeMeta, CONFIG_DIR } from "./auth.js";

type AccountsSource = { op?: string; section?: string; file?: string };
async function readConfig(): Promise<{ accounts?: AccountsSource }> {
  try {
    return JSON.parse(await readFile(path.join(CONFIG_DIR, "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const force = flag("--force");

type Entry = { name: string; email: string };

async function fromOnePassword(item: string, section: string): Promise<Entry[]> {
  const { stdout } = await run("op", ["item", "get", item, "--format", "json"]);
  const fields: { label?: string; value?: string; section?: { label?: string } }[] = JSON.parse(stdout).fields ?? [];
  const out = fields
    .filter((f) => f.section?.label === section && f.label && f.value)
    .map((f) => ({ name: f.label!.trim(), email: f.value!.trim() }));
  if (!out.length) throw new Error(`No fields in section "${section}" of 1Password item "${item}".`);
  return out;
}

async function fromJson(path: string): Promise<Entry[]> {
  const text = path === "-" ? await new Promise<string>((res) => { let b = ""; process.stdin.on("data", (c) => (b += c)).on("end", () => res(b)); }) : await readFile(path, "utf-8");
  const list = JSON.parse(text);
  if (!Array.isArray(list) || !list.every((e) => e?.name && e?.email)) throw new Error('Expected a JSON array of { "name", "email" }.');
  return list;
}

async function registerFromList(list: Entry[]): Promise<void> {
  const bad = list.filter((e) => !/^[a-z0-9][a-z0-9._-]*$/i.test(e.name) || !e.email.includes("@"));
  if (bad.length) throw new Error(`Invalid entries: ${bad.map((b) => `${b.name}=${b.email}`).join(", ")}`);
  const wanted = new Set(list.map((e) => e.name));
  const strays = (await listAccountDirs()).filter((d) => !wanted.has(d));
  const summary: string[] = [];
  for (const { name, email } of list) {
    await writeMeta(name, email);
    const c = force ? { ok: false, detail: "forced", email: undefined } : await checkAccount(name);
    if (c.ok && c.email?.toLowerCase() === email.toLowerCase()) {
      summary.push(`✓ ${name} <${email}> — valid, skipped`);
      continue;
    }
    const why = c.ok ? `token belongs to ${c.email}, list says ${email}` : c.detail;
    console.error(`→ ${name} <${email}>: ${why}. Opening browser…`);
    try {
      await authorizeInteractive(name, { force: true, email });
      summary.push(`✓ ${name} <${email}> — authorized`);
    } catch (err) {
      summary.push(`✗ ${name} <${email}> — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.error(`\nSummary:\n${summary.join("\n")}`);
  if (strays.length) console.error(`\n⚠ On disk but not in the list (left untouched): ${strays.join(", ")}`);
  if (summary.some((l) => l.startsWith("✗"))) process.exit(1);
}

const cfg = (await readConfig()).accounts;
const opItem = opt("--op") ?? (args.some((a) => !a.startsWith("--")) || flag("--all") || opt("--list") ? undefined : cfg?.op);
const listPath = opt("--list") ?? (opItem ? undefined : args.length === 0 ? cfg?.file : undefined);
if (opItem || listPath) {
  const list = opItem ? await fromOnePassword(opItem, opt("--section") ?? cfg?.section ?? "accounts") : await fromJson(listPath!);
  await registerFromList(list);
} else {
  const all = flag("--all");
  const emailIdx = args.indexOf("--email");
  const email = emailIdx >= 0 ? args[emailIdx + 1] : undefined;
  const account = args.find((a, i) => !a.startsWith("--") && i !== emailIdx + 1);
  if (!account && !all) {
    console.error([
      "Usage: pnpm run auth <account> [--force] [--email x@gmail.com]",
      "       pnpm run auth --all [--force]",
      '       pnpm run auth --op "<1Password item>" [--section accounts] [--force]',
      "       pnpm run auth --list accounts.json|- [--force]",
      "       pnpm run auth                      (uses ~/.google-mcp/config.json → accounts.op / accounts.file)",
    ].join("\n"));
    process.exit(1);
  }
  const targets = all ? await listAccounts() : [account!];
  if (targets.length === 0) { console.error("No accounts configured yet — authorize one by name first."); process.exit(1); }
  for (const a of targets) {
    const result = await authorizeInteractive(a, { force: force || all, email: all ? undefined : email });
    console.error(result === "already" ? `"${a}" already has a token. Use --force to re-authorize.` : `✓ Authorized "${a}".`);
  }
}
