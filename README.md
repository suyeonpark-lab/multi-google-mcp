# multi-google-mcp

> 🇬🇧 English: [README.en.md](./README.en.md)

[Claude Code](https://claude.com/claude-code)에서 **여러 Google 계정**의 **Gmail · Calendar · Drive**를 다루는
[MCP](https://modelcontextprotocol.io) 서버 — 내 OAuth 클라이언트로, TypeScript로 직접 만들었어요.

> 로컬에서 실행돼요. 각자 **자기 Google Cloud OAuth 클라이언트**와 **자기 계정 토큰**을 씁니다.
> 공유·호스팅 없음.

## 도구
| 영역 | 도구 | 설명 |
| --- | --- | --- |
| 공통 | `accounts` | 계정 목록; `check=true`면 토큰 건강검진(만료·스코프) |
| | `authorize` | 계정 브라우저 OAuth 인증; `force=true`면 재인증 |
| | `ping` | 헬스체크 |
| Gmail | `gmail_search` ★ | Gmail 쿼리 문법 검색 |
| | `gmail_list_labels` ★ / `gmail_create_label` | 라벨 목록 / 생성(`/`로 중첩) |
| | `gmail_label` / `gmail_trash` | 스레드 라벨 추가·제거(이름으로; `INBOX` 제거 = 보관) / 휴지통 |
| | `gmail_list_filters` ★ / `gmail_create_filter` | 필터 목록 / 생성 |
| | `gmail_batch` | 쿼리 매칭 전체에 일괄 라벨·보관·휴지통 (미리보기 기본, 휴지통은 `confirmTrash`) |
| Calendar | `calendar_list` ★ | 캘린더 목록 |
| | `calendar_events` ★ | 기간 내 일정 — **전 계정 통합 아젠다**(기본 지금~7일) |
| | `calendar_create_event` / `calendar_update_event` | 일정 생성 / 부분 수정 |
| | `calendar_delete_event` | 일정 삭제(`confirm=true`) |
| Drive | `drive_search` ★ / `drive_recent` ★ | 이름·본문 검색(또는 raw q) / 최근 수정 파일 |
| | `drive_get` / `drive_read` | 메타데이터 / 본문 읽기(Docs→텍스트, Sheets→CSV) |
| | `drive_create` / `drive_update` | 폴더·텍스트 파일 생성(Google Doc 변환 가능) / 이름 변경·이동·본문 교체 |
| | `drive_trash` | 휴지통(`confirm=true`) |

모든 도구는 `account` 인자를 받아요. ★ 표시(읽기 전용)는 `account="all"`(여럿일 때 기본)로
**전 계정에 동시 조회**하고 계정별로 묶어 보여줘요. 쓰기 도구는 계정 하나를 지정해야 합니다.

시간 입력: `"YYYY-MM-DD"`(종일) 또는 `"YYYY-MM-DDTHH:MM"`(`timeZone` 기준, 기본 `Asia/Seoul`,
환경변수 `GOOGLE_MCP_TZ`로 변경).

## 동작 원리

**MCP 기본.** MCP 서버는 stdin/stdout으로 MCP 프로토콜(JSON-RPC)을 주고받는 작은 프로그램이에요.
Claude Code가 자식 프로세스로 띄우고, 도구 목록(`tools/list`)을 묻고, 호출(`tools/call`)해요.
이 서버는 공식 `@modelcontextprotocol/sdk`를 써요 — 도구만 등록하면 SDK가 프로토콜을 처리합니다.

**계층 구조.**
```
Claude Code ──(stdio 위 JSON-RPC)──▶ src/index.ts            (공통 도구 + 모듈 등록)
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
            src/tools/gmail.ts   src/tools/calendar.ts   src/tools/drive.ts
                     └────────────────────┼────────────────────┘
                                          ▼
                                     src/google.ts   (API 클라이언트 · 계정 fan-out · 시간 변환)
                                          ▼
                                     src/auth.ts     (계정별 OAuth 토큰 · 건강검진)
                                          ▼
                                 Gmail / Calendar / Drive API (googleapis)
```

**인증(OAuth 2.0).** Google Cloud 프로젝트가 OAuth *클라이언트*(`credentials.json`)를 제공해요.
`pnpm run auth <account>`가 브라우저를 열어 권한을 받으면, *refresh token*이
`~/.google-mcp/<account>/token.json`에 저장돼요. 런타임엔 그 토큰으로 짧은 access token을
자동 갱신 — 브라우저는 필요 없어요. 한 번의 동의가 Gmail·Calendar·Drive 스코프를 모두 포함해요.

**멀티계정.** 서버 하나, 계정 여러 개. 각 계정은 토큰 폴더일 뿐이고, 도구가 `account`
인자로 골라요. `credentials.json`(앱 정체성)은 공유하고, 토큰만 계정별로 달라요.
읽기 도구의 `"all"`은 계정마다 병렬 호출 후 결과를 합치고, 한 계정이 실패해도 나머지는 보여줘요.

**시크릿.** `credentials.json`·`token.json`은 `~/.google-mcp/`(레포 밖)에 있고 gitignore돼요.

## 셋업

### 1. Google Cloud OAuth 클라이언트 (1회)
1. [console.cloud.google.com](https://console.cloud.google.com) → 새 프로젝트 → **Gmail API · Google Calendar API · Google Drive API** 사용 설정
2. OAuth 동의 화면: **External**; 본인 Google 계정들을 **테스트 사용자**에 추가
3. 사용자 인증 정보 → **OAuth 클라이언트 ID** → **데스크톱 앱** → **JSON 다운로드**
4. `~/.google-mcp/credentials.json`으로 저장
5. **게시 상태를 프로덕션으로** 전환 — 테스트 모드의 refresh token은 **7일 뒤 만료**(`invalid_grant`)돼요.
   미검증 앱이라 "확인되지 않은 앱" 경고는 계속 뜨지만, 토큰은 영구화돼요.

### 2. 빌드
```bash
pnpm install
pnpm build
```

### 3. 계정 인증
한 계정씩:
```bash
pnpm run auth <account> --email <주소>   # 이메일을 주면 계정 선택이 고정되고, 다른 계정을 고르면 저장이 거부돼요
pnpm run auth <account> --force          # 만료(invalid_grant)·스코프 추가 후 재인증
```
**목록 기반(권장).** 계정 목록 문서를 정본으로 두고, 스크립트가 읽어서 **부족한 계정만** 브라우저를 열어요(멱등 — 언제 돌려도 안전).
```bash
# 1Password: 항목의 커스텀 섹션 `accounts`에 필드(라벨=등록명, 값=이메일)를 두면
pnpm run auth --op "<1Password 항목 이름>"        # [--section accounts]
# 또는 JSON 파일/표준입력: [{"name":"work","email":"me@work.com"}, …]
pnpm run auth --list accounts.json
```
각 계정의 기대 이메일을 `meta.json`에 기록하고, 토큰을 검사해 ✓면 건너뛰고, 없음·만료·스코프 부족·**다른 계정의 토큰**이면 재인증해요.
목록에 없는데 디스크에 있는 계정은 경고만 하고 지우지 않아요.

## Claude Code에서 사용
한 번 등록 — node **절대경로**를 써요 (fnm/nvm의 node는 spawn PATH에 없어서):
```bash
claude mcp add multi-google-mcp -s user -- /절대경로/node /절대경로/multi-google-mcp/dist/index.js
```
fnm 사용자는 `~/.local/share/fnm/aliases/default/bin/node`(default 별칭 심볼릭 링크)로 등록하면 Node를 올려도 등록이 깨지지 않아요.
`which node`가 주는 `fnm_multishells/…` 경로는 셸 임시 경로라 쓰면 안 돼요.
그다음 새 세션에서: *"이번 주 전 계정 일정 보여줘"*, *"myaccount에서 안 읽은 메일 검색해줘"*,
*"work 드라이브에서 '계약서' 찾아줘"*.

## 새 머신에서 복원
토큰은 백업하지 않아요 — 복원은 "클라이언트 파일 복원 + 계정별 재인증"이에요.
1. 비밀 저장소(예: 1Password)에서 `credentials.json`을 `~/.google-mcp/`로 복원 (`chmod 700 ~/.google-mcp && chmod 600 ~/.google-mcp/credentials.json`)
2. `pnpm install && pnpm build`
3. `claude mcp add multi-google-mcp -s user -- /절대경로/node /절대경로/multi-google-mcp/dist/index.js`
4. `pnpm run auth --op "<1Password 항목>"` (또는 `--list accounts.json`) — 목록의 계정을 순서대로 인증
5. 새 세션에서 `accounts check=true`로 전부 ✓ 확인

## 스코프
`gmail.modify`(읽기+라벨+휴지통) · `gmail.settings.basic`(필터) · `calendar.readonly`+`calendar.events`(캘린더 설정·공유 권한은 제외) · `drive`(전체 파일 — 기존 파일 검색·수정에 필요).
스코프를 추가하면 모든 계정을 `--force`로 재인증해야 해요. `accounts check=true`가 빠진 스코프를 알려줍니다.
