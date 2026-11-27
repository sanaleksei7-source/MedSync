import http from "node:http";
import { RateLimiter, hostAllowed, isJson, originAllowed } from "./guards";
import { LoginThrottle, SessionStore, TokenStore, verifyPassword, verifyTotp } from "./auth";
import { appendRecord, verifyChain, type AuditEvent, type AuditRecord } from "./audit";
import { canAccessPatient, can, type Actor, type Role } from "./rbac";
import type { Signer } from "./signer";
import { MAX_SECONDS, MIN_SECONDS, SAMPLE_RATE, SILENCE_RMS, isHallucination, isNonSpeechAnnotation, rms, type AsrEngine } from "./asr/engine";
import { patients } from "../src/data/patients";
import { docs, type Line, type Section } from "../src/data/script";
import { MAX_OPEN_PER_USER, MemoryVisitStore, applyChanges, VersionConflictError, blockersFor, clampSections, createVisit, documentHash, isDocType, parseLines, toView, type VisitStore } from "./visits";

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: Role;
  passwordHash: string;
  totpSecret: string;
  assignedPatients: string[];
}

export interface Deps {
  users: UserRecord[];
  sessions: SessionStore;
  visits?: VisitStore; // приёмы; по умолчанию в памяти (на шаге 3.2 — база данных)
  tokens?: TokenStore; // вход для мобильных приложений; без него вход по токену отключён
  appOrigins?: string[]; // origin обёрнутых приложений (capacitor://localhost, https://localhost): им разрешены CORS и токены, но не cookie
  throttle: LoginThrottle;
  signer: Signer;
  audit: AuditRecord[];
  persistAudit: (r: AuditRecord) => void;
  ipLimitPerMinute?: number;
  loginLimitPerMinute?: number; // по умолчанию 20 с одного адреса

  asr?: AsrEngine | null; // распознавание речи; null — не настроено
  extract: (docTitle: string, sectionTitles: string[], lines: Line[]) => Promise<Section[]>;
  allowedOrigins: string[];
  allowedHosts?: string[]; // по умолчанию — локальные адреса (guards.hostAllowed)
  secureCookie: boolean;
  dummyHash: string; // для выравнивания времени ответа, когда пользователя не существует
  now?: () => number;
}

const COOKIE = "medsync_session";

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function bearerToken(req: http.IncomingMessage): string | undefined {
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(req.headers.authorization ?? "");
  return m?.[1];
}

function cookieToken(req: http.IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return undefined;
}

export function createHandler(deps: Deps) {
  const now = deps.now ?? Date.now;
  const visits = deps.visits ?? new MemoryVisitStore();
  const ipLimiter = new RateLimiter(deps.ipLimitPerMinute ?? 600, 60_000); // клиника может быть за одним внешним адресом
  const loginLimiter = new RateLimiter(deps.loginLimitPerMinute ?? 20, 60_000);
  const refreshLimiter = new RateLimiter(60, 60_000); // обновление токена идёт каждые несколько минут, 60 в минуту с адреса клиники хватает
  const extractLimiter = new RateLimiter(10, 60_000);
  const asrLimiter = new RateLimiter(60, 60_000); // сегмент речи ≈ 5–25 с, 60 в минуту хватает с запасом

  const log = (e: Omit<AuditEvent, "time">) => {
    const rec = appendRecord(deps.audit, { time: new Date(now()).toISOString(), ...e });
    deps.persistAudit(rec);
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = (req.url ?? "").split("?")[0];
    const host = req.headers.host;
    if (!(deps.allowedHosts ? deps.allowedHosts.includes(host ?? "") : hostAllowed(host))) return send(res, 403, { error: "Forbidden" });
    const appOrigins = deps.appOrigins ?? [];
    const origin = req.headers.origin;
    const fromApp = origin !== undefined && appOrigins.includes(origin);
    if (!originAllowed(origin, [...deps.allowedOrigins, ...appOrigins])) return send(res, 403, { error: "Forbidden" });
    if (fromApp) {
      // CORS только для перечисленных приложений и без credentials: cookie с них не принимаются.
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Sample-Rate");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
      if (req.method === "OPTIONS") { res.writeHead(204); return void res.end(); }
    }
    if (!ipLimiter.allow(req.socket.remoteAddress ?? "unknown")) return send(res, 429, { error: "Слишком много запросов" });

    const isPost = req.method === "POST";
    if (isPost) {
      const wantsAudio = url === "/api/asr";
      if (wantsAudio ? !(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/octet-stream") : !isJson(req.headers["content-type"]))
        return send(res, 415, { error: wantsAudio ? "Нужен Content-Type: application/octet-stream" : "Нужен Content-Type: application/json" });
      // Нестандартный заголовок нельзя отправить с чужого сайта без CORS-preflight (который мы не разрешаем).
      if (req.headers["x-requested-with"] !== "medsync") return send(res, 403, { error: "Forbidden" });
    }

    // ---- вход ----
    if (isPost && url === "/api/login") {
      if (!loginLimiter.allow(req.socket.remoteAddress ?? "unknown")) return send(res, 429, { error: "Слишком много попыток входа" });
      let body: { username?: unknown; password?: unknown; code?: unknown; client?: unknown };
      try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверный запрос" }); }
      const { username, password, code } = body;
      const wantsToken = body.client === "app";
      // Браузерная версия остаётся на cookie: токен в JavaScript браузера не выдаём.
      if (wantsToken && (!deps.tokens || (origin !== undefined && !fromApp))) return send(res, 400, { error: "Вход по токену недоступен" });
      if (typeof username !== "string" || typeof password !== "string" || typeof code !== "string" || username.length > 64 || password.length > 256)
        return send(res, 400, { error: "Неверный запрос" });
      const key = username.toLowerCase();
      if (deps.throttle.locked(key, now())) {
        log({ actor: "anonymous", action: "login.locked", detail: { user: key } });
        return send(res, 429, { error: "Слишком много неудачных попыток. Подождите 15 минут." });
      }
      const user = deps.users.find((u) => u.username.toLowerCase() === key);
      const passOk = await verifyPassword(password, user ? user.passwordHash : deps.dummyHash);
      const codeOk = user ? verifyTotp(user.totpSecret, code, now()) : false;
      if (!user || !passOk || !codeOk) {
        deps.throttle.fail(key, now());
        log({ actor: "anonymous", action: "login.fail", detail: { user: key } });
        return send(res, 401, { error: "Неверное имя, пароль или код" });
      }
      deps.throttle.reset(key);
      if (wantsToken) {
        const pair = deps.tokens!.issue(user.id, now());
        log({ actor: user.id, action: "login.ok", detail: { client: "app" } });
        return send(res, 200, { id: user.id, name: user.name, role: user.role, ...pair });
      }
      const token = deps.sessions.create(user.id, now());
      log({ actor: user.id, action: "login.ok" });
      const cookie = `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${deps.secureCookie ? "; Secure" : ""}`;
      return send(res, 200, { id: user.id, name: user.name, role: user.role }, { "Set-Cookie": cookie });
    }

    // ---- обновление токена приложения ----
    if (isPost && url === "/api/token/refresh") {
      if (!deps.tokens) return send(res, 400, { error: "Вход по токену недоступен" });
      if (!refreshLimiter.allow(req.socket.remoteAddress ?? "unknown")) return send(res, 429, { error: "Слишком много попыток" });
      let body: { refreshToken?: unknown };
      try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверный запрос" }); }
      const r = typeof body.refreshToken === "string" && body.refreshToken.length <= 128 ? deps.tokens.refresh(body.refreshToken, now()) : null;
      if (!r) return send(res, 401, { error: "Требуется вход" });
      if ("reuse" in r) {
        log({ actor: r.userId, action: "token.reuse", detail: { client: "app" } });
        return send(res, 401, { error: "Требуется вход" }); // старый токен предъявлен повторно: все токены этого входа отозваны
      }
      const u = deps.users.find((x) => x.id === r.userId);
      if (!u) return send(res, 401, { error: "Требуется вход" });
      log({ actor: u.id, action: "token.refresh", detail: { client: "app" } });
      return send(res, 200, { id: u.id, name: u.name, role: u.role, ...r.pair });
    }

    // ---- всё остальное требует сессии ----
    // Два разных вида сессии. Если пришли оба признака сразу — отказ, чтобы их нельзя было перепутать.
    const bearer = bearerToken(req);
    const cookie = cookieToken(req);
    if (bearer && cookie) return send(res, 400, { error: "Неверный запрос" });
    if (req.headers.authorization && !bearer) return send(res, 401, { error: "Требуется вход" });
    // Запросы приложений идут только по токену; браузерные — только по cookie.
    if (fromApp && cookie) return send(res, 401, { error: "Требуется вход" });
    const token = cookie;
    let userId: string | undefined;
    let tokenFamily: string | undefined;
    if (bearer) {
      const a = deps.tokens?.authenticate(bearer, now());
      userId = a?.userId;
      tokenFamily = a?.family;
    } else {
      userId = deps.sessions.get(token, now())?.userId;
    }
    const user = userId ? deps.users.find((u) => u.id === userId) : undefined;
    if (!user) return send(res, 401, { error: "Требуется вход" });
    const actor: Actor = { id: user.id, role: user.role, assignedPatients: user.assignedPatients };

    if (isPost && url === "/api/logout") {
      if (tokenFamily) deps.tokens!.revoke(tokenFamily);
      else deps.sessions.destroy(token);
      log({ actor: user.id, action: "logout" });
      return send(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (req.method === "GET" && url === "/api/me") return send(res, 200, { id: user.id, name: user.name, role: user.role });

    if (req.method === "GET" && url === "/api/audit/verify") {
      if (!can(actor, "audit.verify")) return send(res, 403, { error: "Недостаточно прав" });
      log({ actor: user.id, action: "audit.verify" });
      return send(res, 200, verifyChain(deps.audit));
    }

    if (isPost && url === "/api/asr") {
      if (!can(actor, "asr.run")) return send(res, 403, { error: "Недостаточно прав" });
      if (!deps.asr) return send(res, 503, { error: "Сервис распознавания речи не настроен (см. docs/ASR_DESIGN.md)" });
      if (!asrLimiter.allow(user.id)) return send(res, 429, { error: "Слишком много запросов" });
      if (req.headers["x-sample-rate"] !== String(SAMPLE_RATE)) return send(res, 400, { error: `Нужен PCM ${SAMPLE_RATE} Гц` });
      let buf: Buffer;
      try { buf = await readRaw(req, MAX_SECONDS * SAMPLE_RATE * 2 + 1024); } catch { return send(res, 413, { error: "Сегмент слишком длинный" }); }
      const seconds = buf.length / 2 / SAMPLE_RATE;
      if (buf.length % 2 !== 0 || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return send(res, 400, { error: "Неверная длина сегмента" });
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
      // Аудио существует только в памяти этого запроса. Не пишется на диск и не попадает в журнал.
      log({ actor: user.id, action: "asr.segment", detail: { seconds: Math.round(seconds * 10) / 10 } });
      if (rms(pcm) < SILENCE_RMS) return send(res, 200, { text: "", dropped: "silence" });
      try {
        const { text, words } = await deps.asr.transcribe(pcm);
        if (isHallucination(text)) return send(res, 200, { text: "", dropped: "hallucination" });
        if (isNonSpeechAnnotation(text)) return send(res, 200, { text: "", dropped: "annotation" });
        return send(res, 200, words ? { text, words } : { text });
      } catch {
        return send(res, 502, { error: "Сервис распознавания недоступен" }); // детали и текст не раскрываем и не пишем
      }
    }

    // ---- приёмы: расшифровка, черновик и решения врача хранит сервер ----
    const visitUrl = /^\/api\/visits(?:\/([0-9a-f]{32}))?(?:\/(transcript|extract|decisions|sign))?$/.exec(url);
    if (visitUrl) {
      const [, visitId, action] = visitUrl;

      if (isPost && !visitId && !action) {
        if (!can(actor, "visit.edit")) return send(res, 403, { error: "Недостаточно прав" });
        let body: { patientId?: unknown; docType?: unknown; demo?: unknown };
        try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверные данные запроса" }); }
        if (typeof body.patientId !== "string" || !isDocType(body.docType) || (body.demo !== undefined && typeof body.demo !== "boolean"))
          return send(res, 400, { error: "Неверные данные запроса" });
        if (!canAccessPatient(actor, "visit.edit", body.patientId) || !patients.some((p) => p.id === body.patientId)) {
          log({ actor: user.id, action: "visit.denied", target: String(body.patientId).slice(0, 32) });
          return send(res, 403, { error: "Нет доступа к этому пациенту" });
        }
        if ((await visits.countDrafts(user.id)) >= MAX_OPEN_PER_USER) return send(res, 429, { error: "Слишком много незавершённых приёмов" });
        const v = createVisit(user.id, body.patientId, body.docType, body.demo === true, new Date(now()).toISOString());
        await visits.save(v);
        log({ actor: user.id, action: "visit.create", target: v.id, detail: { source: v.source, docType: v.docType } });
        return send(res, 200, toView(v));
      }

      if (visitId) {
        const v = await visits.get(visitId);
        // Чужой приём выглядит так же, как несуществующий: чужие идентификаторы не перебрать.
        if (!v || v.ownerId !== user.id) {
          if (v) log({ actor: user.id, action: "visit.denied", target: visitId });
          return send(res, 404, { error: "Приём не найден" });
        }
        const patient = patients.find((p) => p.id === v.patientId);
        if (!patient || !canAccessPatient(actor, "visit.edit", v.patientId)) return send(res, 403, { error: "Нет доступа к этому пациенту" });
        const iso = new Date(now()).toISOString();

        if (req.method === "GET" && !action) {
          log({ actor: user.id, action: "visit.read", target: v.id });
          return send(res, 200, toView(v));
        }
        if (isPost && action) {
          if (v.status === "signed") return send(res, 409, { error: "Документ уже подписан и не меняется" });
          let body: Record<string, unknown> = {};
          try { body = (await readJson(req)) as Record<string, unknown>; } catch { return send(res, 400, { error: "Неверные данные запроса" }); }
          if (!body || typeof body !== "object") return send(res, 400, { error: "Неверные данные запроса" });

          if (action === "transcript") {
            if (v.source === "demo") return send(res, 409, { error: "Демо-разговор менять нельзя" });
            const lines = parseLines(body.lines);
            if (!lines) return send(res, 400, { error: "Неверные данные запроса" });
            // Новая расшифровка делает прежний черновик и решения врача недействительными.
            v.lines = lines; v.sections = null; v.decisions = {}; v.ackAllergy = []; v.updatedAt = iso;
            await visits.save(v);
            log({ actor: user.id, action: "visit.transcript", target: v.id, detail: { lines: lines.length } });
            return send(res, 200, toView(v));
          }

          if (action === "extract") {
            if (!can(actor, "extract.run")) return send(res, 403, { error: "Недостаточно прав" });
            if (v.source === "demo") return send(res, 409, { error: "В демо-приёме черновик уже готов" });
            if (v.lines.length === 0) return send(res, 400, { error: "Нет текста для документа" });
            if (!extractLimiter.allow(user.id)) return send(res, 429, { error: "Слишком много запросов, подождите минуту" });
            log({ actor: user.id, action: "extract.request", target: v.id, detail: { lines: v.lines.length } });
            try {
              const sections = clampSections(await deps.extract(docs[v.docType].title, docs[v.docType].sections.map((x) => x.title), v.lines), v.lines);
              v.sections = sections; v.decisions = {}; v.ackAllergy = []; v.updatedAt = iso;
              await visits.save(v);
              return send(res, 200, toView(v));
            } catch (e) {
              console.error(e);
              return send(res, 502, { error: e instanceof Error && e.message ? e.message : "Ошибка модели" });
            }
          }

          if (action === "decisions") {
            const err = applyChanges(v, patient, body.changes, body.ack, iso);
            if (err) return send(res, 400, { error: err });
            await visits.save(v);
            // В журнал — только вид действия и номер утверждения, без текста.
            const n = Array.isArray(body.changes) ? body.changes.length : 0;
            const k = Array.isArray(body.ack) ? body.ack.length : 0;
            log({ actor: user.id, action: "visit.decision", target: v.id, detail: { changes: n, allergyAck: k } });
            return send(res, 200, toView(v));
          }

          if (action === "sign") {
            if (!canAccessPatient(actor, "document.sign", v.patientId)) {
              log({ actor: user.id, action: "document.sign.denied", target: v.patientId });
              return send(res, 403, { error: "Нет доступа к этому пациенту" });
            }
            if (!v.sections) return send(res, 409, { error: "Черновик ещё не составлен" });
            // Правила проверяются по данным сервера, не по данным клиента.
            const blockers = blockersFor(v, patient);
            if (blockers.unchecked.length || blockers.allergy.length) {
              log({ actor: user.id, action: "document.sign.blocked", target: v.patientId, detail: { unchecked: blockers.unchecked.length, allergy: blockers.allergy.length } });
              return send(res, 409, { error: "Документ нельзя подписать: есть непроверенные факты или конфликт с аллергией", blockers });
            }
            // Хэш считается из данных приёма, которые держит сервер.
            const title = docs[v.docType].title;
            const hash = documentHash(v, patient);
            v.signed = { hash, signature: deps.signer.sign(hash), signedAt: iso, signer: user.name, scheme: deps.signer.scheme, demo: deps.signer.demo };
            v.status = "signed"; v.updatedAt = iso;
            await visits.save(v);
            // В журнал — только идентификаторы и хэш, без текста документа.
            log({ actor: user.id, action: "document.sign", target: v.patientId, detail: { visit: v.id, docType: title, hash, scheme: deps.signer.scheme } });
            return send(res, 200, toView(v));
          }
        }
      }
    }

    return send(res, 404, { error: "Not found" });
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      await handle(req, res);
    } catch (e) {
      // Два запроса одновременно изменили один приём: проигравший получает понятный отказ, данные не теряются.
      if (e instanceof VersionConflictError) return send(res, 409, { error: e.message });
      throw e;
    }
  };
}
