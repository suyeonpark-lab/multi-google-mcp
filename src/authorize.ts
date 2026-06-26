// authorize.ts — one-time OAuth setup. Run with:  pnpm run auth
//
// Opens a browser: pick the Google account + grant access. The resulting
// refresh token is saved to ~/.gmail-mcp/token.json so the server never
// has to prompt again.

import { authorizeInteractive } from "./auth.js";

await authorizeInteractive();
console.error("✓ Authorized. Token saved to ~/.gmail-mcp/token.json");
console.error("  You can now use the `search` tool from Claude.");
