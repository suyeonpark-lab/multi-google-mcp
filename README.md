# gmail-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing
Gmail from Claude Code — multi-account, built in TypeScript.

> Status: 🚧 early. **Milestone 1** = server skeleton with a `ping` tool (no Gmail yet).

## Roadmap
1. ✅ Server skeleton + `ping` tool (verify MCP plumbing)
2. ⬜ Gmail OAuth + `search` tool
3. ⬜ label / trash / filter tools
4. ⬜ multi-account support

## Develop
```bash
pnpm install
pnpm build       # compile src/*.ts -> dist/*.js
pnpm start       # run the compiled server
```

## Use in Claude Code
```bash
claude mcp add gmail -- node /absolute/path/to/gmail-mcp/dist/index.js
```
