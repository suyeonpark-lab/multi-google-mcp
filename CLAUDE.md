# CLAUDE.md — multi-google-mcp

이 레포에서 작업하는 Claude Code를 위한 지침입니다. (한국어 기본 + 영어 병기 — 사용자 학습용)
Guidance for Claude Code working **in this repo**. (Korean primary, English alongside.)

---

## 이게 뭔지 · What this is
**KO** — 여러 Google 계정의 Gmail·Calendar·Drive를 Claude Code에서 다루는 **로컬 MCP 서버**(TypeScript). `@modelcontextprotocol/sdk` + `googleapis` 위에 밑바닥부터 제작. 사용자용 개요·아키텍처는 README 참고.

**EN** — A local MCP server (TypeScript) exposing Gmail, Calendar and Drive tools for multiple Google accounts to Claude Code. Built from scratch on `@modelcontextprotocol/sdk` + `googleapis`. See the README for the user-facing overview and architecture.

---

## 명령어 · Commands
**KO**
- 빌드: `pnpm build` (tsc → `dist/`)
- 실행: `pnpm start` (stdio 서버)
- 계정 인증: `pnpm run auth <account> [--force]` (`--force` = 만료·스코프 변경 후 재인증)
- Node는 **fnm**이 관리. 비대화형 셸에선 먼저 활성화: `eval "$(fnm env)"; fnm use default` — 안 하면 `node`/`pnpm`을 못 찾음.

**EN**
- Build: `pnpm build` (tsc → `dist/`)
- Run: `pnpm start` (stdio server)
- Authorize an account: `pnpm run auth <account> [--force]` (`--force` = re-consent after expiry / scope change)
- Node is managed by **fnm**. In a non-interactive shell, activate first: `eval "$(fnm env)"; fnm use default` — otherwise `node`/`pnpm` aren't found.

---

## 구조 · Layout
**KO**
- `src/index.ts` — 공통 도구(ping, accounts, authorize) + 영역별 register 함수 호출.
- `src/tools/{gmail,calendar,drive}.ts` — 영역별 도구(`gmail_*`, `calendar_*`, `drive_*`). 각 파일은 `registerXxxTools(server)` 하나를 export.
- `src/google.ts` — `getGmail/getCalendar/getDrive`, `accountArg`/`accountOrAllArg`, `ok/fail`, `forEachAccount`(계정 fan-out), `toRfc3339`(시간 변환).
- `src/auth.ts` — SCOPES, OAuth + 멀티계정 토큰 저장(`~/.google-mcp/<account>/token.json`), `checkAccount`(토큰 건강검진), `resolveAccounts`.
- 시크릿은 `~/.google-mcp/`(gitignore): `credentials.json`(공유), 계정별 토큰.

**EN**
- `src/index.ts` — common tools (ping, accounts, authorize) + calls each area's register function.
- `src/tools/{gmail,calendar,drive}.ts` — per-area tools (`gmail_*`, `calendar_*`, `drive_*`); each exports one `registerXxxTools(server)`.
- `src/google.ts` — `getGmail/getCalendar/getDrive`, `accountArg`/`accountOrAllArg`, `ok/fail`, `forEachAccount` (account fan-out), `toRfc3339`.
- `src/auth.ts` — SCOPES, OAuth + multi-account token storage (`~/.google-mcp/<account>/token.json`), `checkAccount` (token health), `resolveAccounts`.
- Secrets in `~/.google-mcp/` (gitignored): `credentials.json` (shared), per-account tokens.

---

## 규칙 · Conventions
**KO**
- ESM + NodeNext: import 경로는 `.ts` 소스라도 `.js`로 끝남.
- **stdout은 MCP 채널 — 로그는 stderr로만** (`console.error`).
- 도구는 `{ content: [{ type: "text", text }] }`를 반환; 에러는 `fail()` 헬퍼로.
- 라벨은 **이름**으로 다룸 (resolveLabelIds가 id로 변환; 시스템 라벨은 이름 그대로).
- 도구 이름은 영역 접두어(`gmail_`/`calendar_`/`drive_`) — claude.ai 커넥터 도구와 구별.
- 모든 도구는 `account` 인자. 읽기 전용은 `accountOrAllArg`+`forEachAccount`로 `"all"` 지원; 쓰기는 `accountArg`(단일).
- 파괴적 도구는 `confirm`/`confirmTrash` 없이는 거부(`fail`).
- Conventional Commits; 신원 = suyeonpark-lab; AI 작업엔 Co-Authored-By 트레일러.

**EN**
- ESM + NodeNext: import specifiers end in `.js` even for `.ts` sources.
- **stdout is the MCP channel — log only to stderr** (`console.error`).
- Tools return `{ content: [{ type: "text", text }] }`; errors via the `fail()` helper.
- Labels are addressed by **name** (resolveLabelIds maps to ids; system labels by name).
- Tool names carry an area prefix (`gmail_`/`calendar_`/`drive_`) to stay distinct from claude.ai connector tools.
- Every tool takes `account`. Read-only tools use `accountOrAllArg`+`forEachAccount` to support `"all"`; write tools use `accountArg` (single).
- Destructive tools refuse (`fail`) without `confirm`/`confirmTrash`.
- Conventional Commits; identity = suyeonpark-lab; Co-Authored-By trailer on AI-assisted work.

---

## 함정 · Gotchas (learned the hard way)
**KO**
- **googleapis@173**이 `google-auth-library` 버전을 혼재시켜 `google.gmail({auth})` 타입 충돌 → `getGmail`에서 `auth as never`로 단언(런타임 무해).
- **Claude 등록**은 **node 절대경로** 필요 (fnm node가 spawn PATH에 없음); Node 버전 바꾸면 재등록.
- **스코프 업그레이드**: `authorizeInteractive`는 토큰이 있으면 스킵 → 스코프 추가 시 전 계정 `pnpm run auth <account> --force`. `accounts check=true`가 빠진 스코프를 보고.
- **OAuth 테스트 모드 = refresh token 7일 만료**(`invalid_grant`). 해법은 동의 화면 프로덕션 게시(코드로 못 고침). API 자체(Calendar/Drive)도 GCP 프로젝트에서 사용 설정돼 있어야 함(403 `accessNotConfigured`).
- corepack은 `devEngines.packageManager.version`을 **정확한 버전**으로 요구(범위 `^11.9.0` ✗).

**EN**
- **googleapis@173** bundles mismatched `google-auth-library` copies → `google.gmail({auth})` type clash; we assert `auth as never` inside `getGmail`. Runtime is fine.
- **Registering with Claude** needs an **absolute node path** (fnm node isn't on the spawn PATH); re-register after a Node version change.
- **Scope upgrade**: `authorizeInteractive` skips if a token exists → after adding a scope, `pnpm run auth <account> --force` for every account. `accounts check=true` reports missing scopes.
- **OAuth testing mode = refresh tokens expire in 7 days** (`invalid_grant`). Fix is publishing the consent screen to production (not fixable in code). Each API (Calendar/Drive) must also be enabled in the GCP project (403 `accessNotConfigured`).
- corepack wants an **exact** `devEngines.packageManager.version` (not a range like `^11.9.0`).

---

## 도구 빠른 테스트 · Test a tool quickly (no Claude needed)
**KO** — 빌드된 서버에 JSON-RPC를 파이프로 넣어 확인:
**EN** — Pipe JSON-RPC into the built server:
```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"accounts","arguments":{"check":true}}}' \
  | node dist/index.js
```
