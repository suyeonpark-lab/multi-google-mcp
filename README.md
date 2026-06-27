# multi-gmail-mcp

> 🇬🇧 English: [README.en.md](./README.en.md)

[Claude Code](https://claude.com/claude-code)에서 **여러 Gmail 계정**을 다루는
[MCP](https://modelcontextprotocol.io) 서버 — 내 OAuth 클라이언트로, TypeScript로 직접 만들었어요.

> 로컬에서 실행돼요. 각자 **자기 Google Cloud OAuth 클라이언트**와 **자기 계정 토큰**을 씁니다.
> 공유·호스팅 없음.

## 도구
| 도구 | 설명 |
| --- | --- |
| `accounts` | 설정된(인증된) 계정 목록 |
| `authorize` | 계정 1회 브라우저 OAuth 인증 |
| `search` | 계정 검색 (Gmail 쿼리 문법) |
| `list_labels` | 계정의 라벨 목록 |
| `create_label` | 라벨 생성 (`/`로 중첩, 예: `보관/금융`) |
| `label` | 스레드에 라벨 추가/제거 (이름으로; `INBOX` 제거 = 보관) |
| `trash` | 스레드 휴지통 이동 |
| `create_filter` | Gmail 필터 생성 (`gmail.settings.basic` 필요) |
| `list_filters` | 필터 목록 |
| `ping` | 헬스체크 |

모든 도구는 선택적 `account` 인자를 받아요. 계정이 하나면 자동 선택, 여럿이면 지정(생략 시 목록 안내).

## 동작 원리

**MCP 기본.** MCP 서버는 stdin/stdout으로 MCP 프로토콜(JSON-RPC)을 주고받는 작은 프로그램이에요.
Claude Code가 자식 프로세스로 띄우고, 도구 목록(`tools/list`)을 묻고, 호출(`tools/call`)해요.
이 서버는 공식 `@modelcontextprotocol/sdk`를 써요 — 도구만 등록하면 SDK가 프로토콜을 처리합니다.

**계층 구조.**
```
Claude Code ──(stdio 위 JSON-RPC)──▶ src/index.ts   (도구 등록)
                                          │
                                          ▼
                                     src/gmail.ts    (getGmail + 라벨 헬퍼)
                                          │
                                          ▼
                                     src/auth.ts     (계정별 OAuth 토큰)
                                          │
                                          ▼
                                     Gmail API (googleapis)
```

**인증(OAuth 2.0).** Google Cloud 프로젝트가 OAuth *클라이언트*(`credentials.json`)를 제공해요.
`pnpm run auth <account>`가 브라우저를 열어 권한을 받으면, *refresh token*이
`~/.gmail-mcp/<account>/token.json`에 저장돼요. 런타임엔 그 토큰을 읽어 짧은 access token을
자동 갱신 — 브라우저는 필요 없어요.

**멀티계정.** 서버 하나, 계정 여러 개. 각 계정은 그냥 토큰 폴더일 뿐이고, 도구가 `account`
인자로 골라요. `credentials.json`(앱 정체성)은 공유하고, 토큰만 계정별로 달라요.

**시크릿.** `credentials.json`·`token.json`은 `~/.gmail-mcp/`(레포 밖)에 있고 gitignore돼요 —
민감 정보는 커밋되지 않아요.

## 셋업

### 1. Google Cloud OAuth 클라이언트 (1회)
1. [console.cloud.google.com](https://console.cloud.google.com) → 새 프로젝트 → **Gmail API** 사용 설정
2. OAuth 동의 화면: **External**; 본인 Gmail 계정을 **테스트 사용자**에 추가
3. 사용자 인증 정보 → **OAuth 클라이언트 ID** → **데스크톱 앱** → **JSON 다운로드**
4. `~/.gmail-mcp/credentials.json`으로 저장

### 2. 빌드
```bash
pnpm install
pnpm build
```

### 3. 계정별 인증
```bash
pnpm run auth <account>      # 예: pnpm run auth myaccount
```

## Claude Code에서 사용
한 번 등록 — node **절대경로**를 써요 (fnm/nvm의 node는 spawn PATH에 없어서):
```bash
claude mcp add multi-gmail-mcp -s user -- /절대경로/node /절대경로/multi-gmail-mcp/dist/index.js
```
그다음 새 세션에서: *"myaccount에서 안 읽은 메일 검색해줘"*

## 로드맵
1. ✅ 서버 골격 + `ping`
2. ✅ Gmail OAuth + `search`
3. ✅ `label` / `trash` / `filter` 도구
4. ✅ 멀티계정 (`account` 인자 + `authorize`)

## 스코프
`gmail.modify`(읽기 + 라벨 + 휴지통)와 `gmail.settings.basic`(필터).
스코프를 추가하기 전에 인증한 토큰은 재인증해야 해요: 토큰 폴더를 지우고 `pnpm run auth <account>`.
