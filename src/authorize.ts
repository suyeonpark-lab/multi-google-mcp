// authorize.ts — OAuth setup per account.
//   pnpm run auth <account> [--force] [--email x@gmail.com]   e.g. pnpm run auth personal
//   pnpm run auth --all [--force]                             re-auth every configured account
//
// Opens a browser: pick THAT Google account + grant access. The refresh token
// is saved to ~/.google-mcp/<account>/token.json. --force re-consents even if a
// token exists (after invalid_grant or added scopes). --email is remembered and
// preselects the account in Google's chooser next time.

import { authorizeInteractive, listAccounts } from "./auth.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const all = args.includes("--all");
const emailIdx = args.indexOf("--email");
const email = emailIdx >= 0 ? args[emailIdx + 1] : undefined;
const account = args.find((a, i) => !a.startsWith("--") && i !== emailIdx + 1);

if (!account && !all) {
  console.error("Usage: pnpm run auth <account> [--force] [--email x@gmail.com]\n       pnpm run auth --all [--force]");
  process.exit(1);
}

const targets = all ? await listAccounts() : [account!];
if (targets.length === 0) {
  console.error("No accounts configured yet — authorize one by name first.");
  process.exit(1);
}
for (const a of targets) {
  const result = await authorizeInteractive(a, { force: force || all, email: all ? undefined : email });
  console.error(
    result === "already"
      ? `"${a}" already has a token. Use --force to re-authorize.`
      : `✓ Authorized "${a}". Token saved to ~/.google-mcp/${a}/token.json`
  );
}
