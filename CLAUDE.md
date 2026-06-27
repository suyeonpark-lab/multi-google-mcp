# CLAUDE.md — multi-gmail-mcp

이 레포에서 작업하는 Claude Code를 위한 지침입니다. (한국어 기본 + 영어 병기 — 사용자 학습용)
Guidance for Claude Code working **in this repo**. (Korean primary, English alongside.)

---

## 이게 뭔지 · What this is
**KO** — 여러 Gmail 계정을 Claude Code에서 다루는 **로컬 MCP 서버**(TypeScript). `@modelcontextprotocol/sdk` + `googleapis` 위에 밑바닥부터 제작. 사용자용 개요·아키텍처는 README 참고.

**EN** — A local MCP server (TypeScript) exposing Gmail tools for multiple accounts to Claude Code. Built from scratch on `@modelcontextprotocol/sdk` + `googleapis`. See the README for the user-facing overview and architecture.

---

## 명령어 · Commands
**KO**
- 빌드: `pnpm build` (tsc → `dist/`)
- 실행: `pnpm start` (stdio 서버)
- 계정 인증: `pnpm run auth <account>`
- Node는 **fnm**이 관리. 비대화형 셸에선 먼저 활성화: `eval "$(fnm env)"; fnm use default` — 안 하면 `node`/`pnpm`을 못 찾음.

**EN**
- Build: `pnpm build` (tsc → `dist/`)
- Run: `pnpm start` (stdio server)
- Authorize an account: `pnpm run auth <account>`
- Node is managed by **fnm**. In a non-interactive shell, activate first: `eval "$(fnm env)"; fnm use default` — otherwise `node`/`pnpm` aren't found.

---

## 구조 · Layout
**KO**
- `src/index.ts` — 모든 도구 등록 (ping, accounts, authorize, search, list_labels, create_label, label, trash, create_filter, list_filters).
- `src/auth.ts` — OAuth + 멀티계정 토큰 저장 (`~/.gmail-mcp/<account>/token.json`).
- `src/gmail.ts` — `getGmail(account)`(인증된 클라이언트) + `resolveLabelIds`(라벨 이름 → id).
- 시크릿은 `~/.gmail-mcp/`(gitignore): `credentials.json`(공유), 계정별 토큰.

**EN**
- `src/index.ts` — registers all tools (ping, accounts, authorize, search, list_labels, create_label, label, trash, create_filter, list_filters).
- `src/auth.ts` — OAuth + multi-account token storage (`~/.gmail-mcp/<account>/token.json`).
- `src/gmail.ts` — `getGmail(account)` (authed client) + `resolveLabelIds` (label names → ids).
- Secrets in `~/.gmail-mcp/` (gitignored): `credentials.json` (shared), per-account tokens.

---

## 규칙 · Conventions
**KO**
- ESM + NodeNext: import 경로는 `.ts` 소스라도 `.js`로 끝남.
- **stdout은 MCP 채널 — 로그는 stderr로만** (`console.error`).
- 도구는 `{ content: [{ type: "text", text }] }`를 반환; 에러는 `fail()` 헬퍼로.
- 라벨은 **이름**으로 다룸 (resolveLabelIds가 id로 변환; 시스템 라벨은 이름 그대로).
- 모든 도구는 선택적 `account` 인자.
- Conventional Commits; 신원 = suyeonpark-lab; AI 작업엔 Co-Authored-By 트레일러.

**EN**
- ESM + NodeNext: import specifiers end in `.js` even for `.ts` sources.
- **stdout is the MCP channel — log only to stderr** (`console.error`).
- Tools return `{ content: [{ type: "text", text }] }`; errors via the `fail()` helper.
- Labels are addressed by **name** (resolveLabelIds maps to ids; system labels by name).
- Every tool takes an optional `account`.
- Conventional Commits; identity = suyeonpark-lab; Co-Authored-By trailer on AI-assisted work.

---

## 함정 · Gotchas (learned the hard way)
**KO**
- **googleapis@173**이 `google-auth-library` 버전을 혼재시켜 `google.gmail({auth})` 타입 충돌 → `getGmail`에서 `auth as never`로 단언(런타임 무해).
- **Claude 등록**은 **node 절대경로** 필요 (fnm node가 spawn PATH에 없음); Node 버전 바꾸면 재등록.
- **스코프 업그레이드**: `authorizeInteractive`는 토큰이 있으면 스킵 → 스코프 추가(예: `gmail.settings.basic`) 시 토큰 폴더를 지우고 재인증.
- corepack은 `devEngines.packageManager.version`을 **정확한 버전**으로 요구(범위 `^11.9.0` ✗).

**EN**
- **googleapis@173** bundles mismatched `google-auth-library` copies → `google.gmail({auth})` type clash; we assert `auth as never` inside `getGmail`. Runtime is fine.
- **Registering with Claude** needs an **absolute node path** (fnm node isn't on the spawn PATH); re-register after a Node version change.
- **Scope upgrade**: `authorizeInteractive` skips if a token exists, so adding a scope (e.g. `gmail.settings.basic`) requires deleting the token folder, then re-auth.
- corepack wants an **exact** `devEngines.packageManager.version` (not a range like `^11.9.0`).

---

## 도구 빠른 테스트 · Test a tool quickly (no Claude needed)
**KO** — 빌드된 서버에 JSON-RPC를 파이프로 넣어 확인:
**EN** — Pipe JSON-RPC into the built server:
```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"accounts","arguments":{}}}' \
  | node dist/index.js
```
