// authorize.ts — one-time OAuth setup per account.
//   pnpm run auth <account>      e.g.  pnpm run auth personal
//
// Opens a browser: pick THAT Google account + grant access. The refresh token
// is saved to ~/.gmail-mcp/<account>/token.json.

import { authorizeInteractive } from "./auth.js";

const account = process.argv[2];
if (!account) {
  console.error("Usage: pnpm run auth <account>   (e.g. pnpm run auth personal)");
  process.exit(1);
}

await authorizeInteractive(account);
console.error(`✓ Authorized "${account}". Token saved to ~/.gmail-mcp/${account}/token.json`);
