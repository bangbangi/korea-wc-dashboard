/**
 * 월드컵 2026 대시보드 — Cloudflare Worker (데이터: worldcup26.ir)
 *
 *  공개 프록시:
 *    /api/games | /api/groups | /api/teams | /api/stadiums  -> worldcup26.ir/get/<name>
 *
 *  관리자 저장(같은 KV 사용):
 *    GET  /api/players      -> 선수 한글 오버라이드 { normName: "한글", ... }
 *    POST /api/players      -> { name, ko } 추가 / { remove } 삭제   (관리자 토큰 필요)
 *    GET  /api/broadcast    -> 중계 링크 { chzzk, jtbc, label }
 *    POST /api/broadcast    -> 위 객체 병합 저장                      (관리자 토큰 필요)
 *
 *  관리자 토큰 설정:  npx wrangler secret put ADMIN_TOKEN
 *  (토큰을 설정하지 않으면 쓰기(POST)는 비활성, 읽기/프록시는 정상 동작)
 */

const API_BASE = "https://worldcup26.ir";
const ROUTES = { games: 30, groups: 60, teams: 86400, stadiums: 86400 };
const KV_KEYS = { players: "admin:players", broadcast: "admin:broadcast", countries: "admin:countries", venues: "admin:venues" };

// ---- Highlightly (도움/공격포인트 소스) ----
const HL_BASE = "https://soccer.highlightly.net";
const HL_SEASON = 2026;
const HL_SYNC_MS = 18 * 60 * 1000; // 최소 동기화 간격(분) — 무료 100/일 보호
const HL_SCHED_MS = 3 * 60 * 60 * 1000; // 전체 일정 갱신 간격(3시간)
const HL_LIVE = ["First half", "Second half", "Half time", "Extra time", "Break time", "Penalties", "In progress"];
const HL_FIN = ["Finished", "Finished after penalties", "Finished after extra time"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    const endpoint = url.pathname.slice("/api/".length).replace(/\/+$/, "");

    // ---- 관리자 비밀번호 확인 ----
    if (endpoint === "verify") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.ADMIN_TOKEN) return json({ error: "admin disabled (set ADMIN_TOKEN)" }, 403);
      if ((request.headers.get("Authorization") || "") !== "Bearer " + env.ADMIN_TOKEN) return json({ ok: false }, 401);
      return json({ ok: true });
    }

    // ---- 방문자 국가 (자동 언어 선택용) ----
    if (endpoint === "geo") {
      return json({ country: (request.cf && request.cf.country) || "" }, 200, { "Cache-Control": "no-store" });
    }

    // ---- 도움/공격포인트 집계 (Highlightly) ----
    if (endpoint === "points") {
      const v = env.CACHE ? await env.CACHE.get("hl:points") : null;
      return raw(v || JSON.stringify({ updated: null, players: [] }), 200, { "Cache-Control": "public, max-age=60" });
    }

    // ---- 관리자 저장 엔드포인트 ----
    if (endpoint === "players" || endpoint === "broadcast" || endpoint === "countries" || endpoint === "venues") {
      const kvKey = KV_KEYS[endpoint];
      if (request.method === "GET") {
        const v = env.CACHE ? await env.CACHE.get(kvKey) : null;
        return raw(v || "{}", 200, { "Cache-Control": "public, max-age=15" });
      }
      if (request.method === "POST") {
        if (!env.ADMIN_TOKEN) return json({ error: "admin disabled (set ADMIN_TOKEN)" }, 403);
        if ((request.headers.get("Authorization") || "") !== "Bearer " + env.ADMIN_TOKEN) return json({ error: "unauthorized" }, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "bad json" }, 400);
        }
        const cur = JSON.parse((env.CACHE && (await env.CACHE.get(kvKey))) || "{}");
        if (endpoint === "broadcast") {
          for (const k of ["chzzk", "kbs", "jtbc", "label"]) if (k in body) cur[k] = String(body[k] || "");
        } else {
          // players / countries / venues : 이름 키 기반 한글 오버라이드
          if (body.remove) delete cur[normName(body.remove)];
          else if (body.bulk && typeof body.bulk === "object") {
            let n = 0;
            for (const k in body.bulk) {
              const ko = String(body.bulk[k] || "").trim(),
                nk = normName(k);
              if (nk && ko) {
                cur[nk] = ko;
                n++;
              }
            }
            if (!n) return json({ error: "empty bulk" }, 400);
          } else if (body.name && body.ko) cur[normName(body.name)] = String(body.ko);
          else return json({ error: "need {name, ko} or {bulk} or {remove}" }, 400);
        }
        if (env.CACHE) await env.CACHE.put(kvKey, JSON.stringify(cur));
        return json({ ok: true, data: cur });
      }
      return json({ error: "method not allowed" }, 405);
    }

    // ---- 공개 프록시 (Cache API 사용: KV 읽기/쓰기 한도 미소모) ----
    const ttl = ROUTES[endpoint];
    if (ttl === undefined) return json({ error: "Unknown endpoint", code: 404 }, 404);
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: "GET" }); // 자기 도메인 키(안전)
    const hit = await cache.match(cacheKey);
    if (hit) return hit; // 엣지 캐시 적중
    try {
      const res = await fetch(`${API_BASE}/get/${endpoint}`, { headers: { Accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) return json({ error: "Upstream " + res.status, code: res.status }, 502);
      const out = raw(text, 200, { "Cache-Control": `public, max-age=${Math.max(ttl, 30)}`, "X-Cache": "MISS" });
      ctx.waitUntil(cache.put(cacheKey, out.clone())); // Cache-Control 의 max-age 만큼만 보관
      return out;
    } catch (e) {
      return json({ error: "Upstream fetch failed", code: 502 }, 502);
    }
  },

  async scheduled(event, env, ctx) {
    // 데이터 캐시는 이제 Cache API(요청 시 자동 캐싱)가 담당 → 크론에서 KV 쓰기 없음
    ctx.waitUntil(syncHighlightly(env).catch(() => {}));
  },
};

// 프론트의 normName과 동일한 정규화(대소문자/점/하이픈/발음기호 무시)
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================= Highlightly: 도움/공격포인트 집계 =================
 * 무료 100요청/일을 지키기 위한 설계:
 *  - worldcup26(무료, 이미 캐시됨)가 "라이브" 또는 "처리 안 된 종료 경기"를 알릴 때만 Highlightly 호출
 *  - 종료된 경기는 단 한 번만 /matches/{id}로 이벤트를 받아 KV(hl:tally)에 누적
 *  - 라이브 경기만 /events/{id}로 임시 집계 → 누적분과 합쳐 hl:points 저장
 *  - 한 번 실행당 호출 상한 + x-ratelimit-remaining 감시로 쿼터 보호
 */
async function syncHighlightly(env) {
  if (!env.HIGHLIGHTLY_KEY || !env.CACHE) return; // 키 없으면 기능 비활성(안전)
  const now = Date.now();
  const last = Number((await env.CACHE.get("hl:lastsync")) || 0);
  if (now - last < HL_SYNC_MS) return; // 간격 게이트

  // worldcup26(무료)로 종료/라이브 경기를 먼저 파악 → 없으면 Highlightly 호출 0
  // (games 는 더 이상 KV에 없으므로 18분에 1번 원본에서 직접 받음 = 하루 최대 ~80회, 무시 가능)
  let games = [];
  try {
    const r = await fetch(`${API_BASE}/get/games`, { headers: { Accept: "application/json" } });
    if (r.ok) games = JSON.parse(await r.text()).games || [];
  } catch (_) {}
  const statusOf = (g) => {
    const te = String((g && g.time_elapsed) || "").toLowerCase();
    if (String(g && g.finished).toUpperCase() === "TRUE" || te === "finished") return "fin";
    if (te === "live" || te === "ht" || /^\d/.test(te) || te.includes("half")) return "live";
    return "pre";
  };
  const finished = games.filter((g) => statusOf(g) === "fin");
  const liveGames = games.filter((g) => statusOf(g) === "live");

  const tally = safeJson(await env.CACHE.get("hl:tally"), { processed: {}, players: {} });
  const needBackfill = finished.length > Object.keys(tally.processed).length;

  await env.CACHE.put("hl:lastsync", String(now)); // 먼저 기록(중복 실행 방지)
  if (!liveGames.length && !needBackfill) return; // 할 일 없음 → 호출 0

  const budget = { left: 12, ok: true };
  const get = (path) => hlGet(env, path, budget);

  // 1) 리그 ID (한 번 찾으면 영구 캐시)
  let leagueId = await env.CACHE.get("hl:league");
  if (!leagueId) {
    const lj = await get(`/leagues?leagueName=${encodeURIComponent("World Cup")}&season=${HL_SEASON}&limit=100`);
    const arr = (lj && lj.data) || [];
    const bad = /(women|qualif|u-?\d|youth|futsal|club|beach)/i;
    const pick = arr.find((l) => /world cup/i.test(l.name || "") && !bad.test(l.name || "")) || arr.find((l) => /world cup/i.test(l.name || ""));
    if (pick && pick.id != null) {
      leagueId = String(pick.id);
      await env.CACHE.put("hl:league", leagueId);
    }
  }
  if (!leagueId) return;

  // 2) 전체 일정(팀쌍 → Highlightly 경기ID) — 3시간마다만 갱신
  let sched = safeJson(await env.CACHE.get("hl:schedule"), null);
  const schedTs = Number((await env.CACHE.get("hl:schedts")) || 0);
  if (!sched || now - schedTs > HL_SCHED_MS) {
    const map = {};
    for (const off of [0, 100]) {
      if (budget.left <= 0 || !budget.ok) break;
      const mj = await get(`/matches?leagueId=${leagueId}&season=${HL_SEASON}&limit=100&offset=${off}`);
      const data = (mj && mj.data) || [];
      for (const m of data) {
        if (!m || m.id == null) continue;
        const hk = pairKey((m.homeTeam && m.homeTeam.name) || "", (m.awayTeam && m.awayTeam.name) || "");
        if (hk) map[hk] = m.id;
      }
      if (data.length < 100) break;
    }
    if (Object.keys(map).length) {
      sched = map;
      await env.CACHE.put("hl:schedule", JSON.stringify(map));
      await env.CACHE.put("hl:schedts", String(now));
    }
  }
  if (!sched) return;
  const hlIdFor = (g) => sched[pairKey(g.home_team_name_en || "", g.away_team_name_en || "")];

  // 3) 종료된 경기 전부 백필 (미처리만, 한 번에 최대 5경기 → 여러 번에 걸쳐 따라잡음)
  let added = 0;
  for (const g of finished) {
    if (budget.left <= 0 || !budget.ok || added >= 5) break;
    const id = hlIdFor(g);
    if (id == null || tally.processed[id]) continue;
    const dj = await get(`/matches/${id}`);
    const det = Array.isArray(dj) ? dj[0] : dj;
    accumulate(tally.players, (det && det.events) || []);
    tally.processed[id] = true;
    added++;
  }
  await env.CACHE.put("hl:tally", JSON.stringify(tally));

  // 4) 라이브 경기 → 임시 집계 (최대 6경기)
  const liveTally = {};
  let lv = 0;
  for (const g of liveGames) {
    if (budget.left <= 0 || !budget.ok || lv >= 6) break;
    const id = hlIdFor(g);
    if (id == null) continue;
    const ej = await get(`/events/${id}`);
    accumulate(liveTally, Array.isArray(ej) ? ej : (ej && ej.data) || []);
    lv++;
  }

  // 5) 누적 + 라이브 병합 → 포인트 리스트 저장
  const merged = {};
  mergeInto(merged, tally.players);
  mergeInto(merged, liveTally);
  let list = Object.values(merged)
    .map((p) => ({ name: p.name, team: p.team, goals: p.goals, assists: p.assists, points: p.goals + p.assists }))
    .filter((p) => p.points > 0)
    .sort((a, b) => b.points - a.points || b.goals - a.goals)
    .slice(0, 40);
  await env.CACHE.put("hl:points", JSON.stringify({ updated: now, matches: Object.keys(tally.processed).length, players: list }));
}

async function hlGet(env, path, budget) {
  if (budget.left <= 0 || !budget.ok) return null;
  budget.left--;
  try {
    const res = await fetch(HL_BASE + path, { headers: { "x-rapidapi-key": env.HIGHLIGHTLY_KEY, Accept: "application/json" } });
    const rem = Number(res.headers.get("x-ratelimit-requests-remaining"));
    if (!Number.isNaN(rem) && rem <= 5) budget.ok = false; // 쿼터 거의 소진 → 추가 호출 중단
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// 이벤트 배열에서 골/도움 누적 (Goal·Penalty만 득점, Own Goal/Missed 제외)
function accumulate(players, events) {
  for (const e of events || []) {
    const type = String((e && e.type) || "");
    if (type !== "Goal" && type !== "Penalty") continue;
    const team = (e.team && e.team.name) || "";
    if (e.player && String(e.player).trim()) bump(players, keyFor(e.playerId, e.player, team), e.player, team, 1, 0);
    if (isName(e.assist)) bump(players, keyFor(e.assistingPlayerId, e.assist, team), e.assist, team, 0, 1);
  }
}
function isName(s) {
  return s != null && /[a-zA-Z\u00C0-\u024F]/.test(String(s)) && String(s).trim().length > 1;
}
function keyFor(id, name, team) {
  return Number(id) > 0 ? "id:" + id : "n:" + normName(name) + "|" + normName(team);
}
function bump(players, k, name, team, g, a) {
  if (!players[k]) players[k] = { name, team, goals: 0, assists: 0 };
  players[k].goals += g;
  players[k].assists += a;
  if (name) players[k].name = name;
  if (team) players[k].team = team;
}
function mergeInto(dst, src) {
  for (const k in src) {
    const p = src[k];
    if (!dst[k]) dst[k] = { name: p.name, team: p.team, goals: 0, assists: 0 };
    dst[k].goals += p.goals;
    dst[k].assists += p.assists;
    if (p.name) dst[k].name = p.name;
    if (p.team) dst[k].team = p.team;
  }
}
function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
function safeJson(s, fb) {
  try {
    return JSON.parse(s || "");
  } catch (_) {
    return fb;
  }
}
// worldcup26 ↔ Highlightly 경기 매칭용: 팀 이름 별칭 + 정렬된 팀쌍 키
const HL_ALIAS = {
  "korea republic": "south korea",
  "ir iran": "iran",
  "iran islamic republic": "iran",
  usa: "united states",
  "united states of america": "united states",
  "china pr": "china",
  czechia: "czech republic",
  turkiye: "turkey",
  "cote d ivoire": "ivory coast",
};
function aliasTeam(s) {
  const k = normName(s);
  return HL_ALIAS[k] || k;
}
function pairKey(a, b) {
  const x = aliasTeam(a),
    y = aliasTeam(b);
  if (!x || !y) return "";
  return [x, y].sort().join("|");
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function raw(text, status = 200, extra = {}) {
  return new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(), ...extra } });
}
function json(obj, status = 200, extra = {}) {
  return raw(JSON.stringify(obj), status, extra);
}
