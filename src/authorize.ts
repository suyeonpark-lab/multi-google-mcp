// authorize.ts — one-time OAuth setup per account.
//   pnpm run auth <account> [--force]     e.g.  pnpm run auth personal
//
// Opens a browser: pick THAT Google account + grant access. The refresh token
// is saved to ~/.gmail-mcp/<account>/token.json. --force re-consents even if a
// token exists (use after invalid_grant or when scopes were added).

import { authorizeInteractive } from "./auth.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const account = args.find((a) => !a.startsWith("--"));
if (!account) {
  console.error("Usage: pnpm run auth <account> [--force]   (e.g. pnpm run auth personal)");
  process.exit(1);
}

const result = await authorizeInteractive(account, force);
console.error(
  result === "already"
    ? `"${account}" already has a token. Use --force to re-authorize.`
    : `✓ Authorized "${account}". Token saved to ~/.gmail-mcp/${account}/token.json`
);
