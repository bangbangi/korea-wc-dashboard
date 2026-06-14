# 월드컵 2026 실시간 대시보드 (국가별)

출전국 아무 나라나 골라 볼 수 있는 FIFA 월드컵 2026 대시보드 (기본 포커스: 대한민국).
**Cloudflare Worker 하나**가 정적 프론트엔드와 API 프록시(`/api/*`)를 같은 도메인에서 함께 서빙합니다.

- 데이터 소스: **worldcup26.ir** (무료·오픈소스). **API 키 불필요.**
- 프론트는 worldcup26.ir이 아니라 **같은 도메인 `/api`** 만 호출 → CORS 없음
- KV 캐시 + 매분 크론으로 games/groups를 미리 받아둠(빠름)

```
korea-wc-dashboard/
├─ package.json        # wrangler 설치/배포 스크립트
├─ wrangler.toml       # 워커 + 정적자산 + KV + 크론
├─ src/worker.js       # /api/* -> worldcup26.ir/get/* 프록시 + 캐시 + 크론
└─ public/index.html   # 대시보드 SPA (국가 선택 · 국기 이미지 · 경기장 카드)
```

## 화면 구성
- **히어로**: 선택 국가의 다음/진행/최근 경기 (라이브면 분 시계, 예정이면 카운트다운)
- **조 순위**: 선택 국가가 속한 조
- **일정·결과**: 선택 국가 경기
- **득점 순위**: 경기 데이터에서 득점자 집계
- **개최 경기장**: 16개 venue (국가별)

상단 드롭다운으로 국가를 바꾸면 위 전부가 그 나라 기준으로 전환됩니다.

## 배포

전제: Node 18+ 설치, Cloudflare 계정.

```bash
npm install                          # wrangler 설치
npx wrangler login                   # 브라우저로 인증

# 캐시용 KV 생성 → 출력된 id를 wrangler.toml의 id 자리에 붙여넣기
npx wrangler kv namespace create CACHE

npx wrangler deploy                  # 배포 (API 키 입력 단계 없음!)
```

끝나면 `https://korea-wc-dashboard.<계정>.workers.dev` 주소가 나옵니다. 그 주소를 공유하면 끝.
크론이 매분 자동으로 데이터를 캐시에 채웁니다.

## 로컬 미리보기
```bash
npx wrangler dev        # http://localhost:8787
```
`public/index.html`만 더블클릭해서 열면 백엔드 없이 **데모 데이터**로 화면만 확인됩니다.

## 이미 배포해둔 경우 (파일만 교체)
기존 Cloudflare 프로젝트가 있으면 `src/worker.js` 와 `public/index.html` 두 파일만 덮어쓰고
`npx wrangler deploy` 하면 됩니다. `wrangler.toml`(KV id 들어있음)은 그대로 두세요.
worldcup26.ir은 키가 필요 없어서, 예전에 넣었던 `WORLDCUP_API_KEY` secret은 안 써도 무방합니다.

## 실제 응답 필드가 바뀌면?
변환은 `public/index.html`의 `normGame` / `buildStandings` / `buildScorers` / `teamSide` 한곳에 모여 있어요.
worldcup26.ir 구조가 바뀌면 거기 키 이름만 맞추면 됩니다.

## 참고
worldcup26.ir은 커뮤니티 오픈소스 API라 가동률·정확도가 상용만큼 보장되진 않습니다.
무료로 공개 대시보드를 돌리기엔 충분하지만, 데이터가 비거나 멈추면 잠시 후 자동 복구를 기다리면 됩니다.

## 비용
Cloudflare 무료 플랜으로 충분합니다 (Workers 하루 10만 요청, KV·크론 무료 범위).
