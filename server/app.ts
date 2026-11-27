import http from "node:http";
import { randomBytes } from "node:crypto";
import { RateLimiter, hostAllowed, isJson, originAllowed } from "./guards";
import { LoginThrottle, SessionStore, TokenStore, hashPassword, newTotpSecret, verifyPassword, verifyTotp } from "./auth";
import { appendRecord, verifyChain, type AuditEvent, type AuditRecord } from "./audit";
import { AlertMonitor, isAlert, type Alert } from "./alerts";
import { canAccessPatient, can, type Actor } from "./rbac";
import { BreakGlass, GRANT_MS, REASONS, isReason } from "./breakglass";
import { ROLES, USERNAME, otpauthUri, passwordProblem, publicUser, tempPassword, type UserRecord } from "./accounts";
import type { Signer } from "./signer";
import { MAX_SECONDS, MIN_SECONDS, SAMPLE_RATE, SILENCE_RMS, isHallucination, isNonSpeechAnnotation, rms, type AsrEngine } from "./asr/engine";
import { patients } from "./patients";
import { docs, type Line, type Section } from "../src/data/script";
import { MAX_OPEN_PER_USER, MemoryVisitStore, applyChanges, VersionConflictError, blockersFor, clampSections, createVisit, documentHash, isDocType, parseLines, toView, toSummary, type VisitStore } from "./visits";

export type { UserRecord };

export interface Deps {
  users: UserRecord[];
  sessions: SessionStore;
  visits?: VisitStore; // приёмы; по умолчанию в памяти (на шаге 3.2 — база данных)
  tokens?: TokenStore; // вход для мобильных приложений; без него вход по токену отключён
  appOrigins?: string[]; // origin обёрнутых приложений (capacitor://localhost, https://localhost): им разрешены CORS и токены, но не cookie
  throttle: LoginThrottle;
  signer: Signer;
  audit: AuditRecord[];
  /** Запись в постоянное хранилище. Если вернул Promise, записи идут по очереди, а при сбое сервер отказывает в запросах. */
  persistAudit: (r: AuditRecord) => void | Promise<void>;
  /** Куда ещё сообщить о тревоге (почта, мессенджер); сама тревога в любом случае попадает в журнал. */
  onAlert?: (a: Alert) => void;
  alerts?: AlertMonitor;
  /** Сохраняет изменённую учётную запись (в базу). Без него изменения живут только в памяти. */
  persistUser?: (u: UserRecord) => void | Promise<void>;
  breakGlass?: BreakGlass;
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

  // Журнал пишется по очереди; если запись не удалась, действия без следа в журнале не допускаются (503).
  let auditQueue: Promise<void> = Promise.resolve();
  let auditFailed = false;
  const monitor = deps.alerts ?? new AlertMonitor();
  const bg = deps.breakGlass ?? new BreakGlass();
  const breakGlassLimiter = new RateLimiter(5, 60_000); // подбор ПИН через экстренный доступ
  const accountLimiter = new RateLimiter(30, 60_000);
  const append = (e: AuditEvent) => {
    const rec = appendRecord(deps.audit, e);
    auditQueue = auditQueue.then(() => (auditFailed ? undefined : deps.persistAudit(rec))).catch((err) => {
      auditFailed = true;
      console.error("Журнал аудита не записан, сервер остановил обслуживание:", err instanceof Error ? err.message : err);
    });
    return rec;
  };
  const log = (e: Omit<AuditEvent, "time">) => {
    const ev = { time: new Date(now()).toISOString(), ...e };
    append(ev);
    for (const a of monitor.observe(ev)) {
      append({ time: ev.time, actor: "system", action: `alert.${a.rule}`, target: a.key, detail: { count: a.count } });
      console.warn(`ТРЕВОГА [${a.rule}] ${a.key}: ${a.message}`);
      deps.onAlert?.(a);
    }
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    await auditQueue;
    if (auditFailed) return send(res, 503, { error: "Журнал аудита недоступен, работа остановлена" });
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
      if (user?.disabled && passOk && codeOk) log({ actor: user.id, action: "login.disabled" }); // учётная запись заблокирована: ответ тот же, что при неверных данных
      if (!user || user.disabled || !passOk || !codeOk) {
        deps.throttle.fail(key, now());
        log({ actor: "anonymous", action: "login.fail", detail: { user: key } });
        return send(res, 401, { error: "Неверное имя, пароль или код" });
      }
      deps.throttle.reset(key);
      if (wantsToken) {
        const pair = deps.tokens!.issue(user.id, now());
        log({ actor: user.id, action: "login.ok", detail: { client: "app" } });
        return send(res, 200, { id: user.id, name: user.name, role: user.role, setup: user.setup ?? null, ...pair });
      }
      const token = deps.sessions.create(user.id, now());
      log({ actor: user.id, action: "login.ok" });
      const cookie = `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${deps.secureCookie ? "; Secure" : ""}`;
      return send(res, 200, { id: user.id, name: user.name, role: user.role, setup: user.setup ?? null }, { "Set-Cookie": cookie });
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
      if (!u || u.disabled) return send(res, 401, { error: "Требуется вход" });
      log({ actor: u.id, action: "token.refresh", detail: { client: "app" } });
      return send(res, 200, { id: u.id, name: u.name, role: u.role, setup: u.setup ?? null, ...r.pair });
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
    if (!user || user.disabled) return send(res, 401, { error: "Требуется вход" });
    const actor: Actor = { id: user.id, role: user.role, assignedPatients: user.assignedPatients, emergencyPatients: bg.active(user.id, now()) };

    // Пока пользователь не завершил настройку (одноразовый пароль, новый секрет второго фактора), доступны только учётная запись, выход и сведения о себе.
    if (user.setup && !(url === "/api/me" || url === "/api/logout" || url.startsWith("/api/account/")))
      return send(res, 403, { error: "Сначала завершите настройку учётной записи", setup: user.setup });

    if (isPost && url === "/api/logout") {
      if (tokenFamily) deps.tokens!.revoke(tokenFamily);
      else deps.sessions.destroy(token);
      log({ actor: user.id, action: "logout" });
      return send(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (req.method === "GET" && url === "/api/me") return send(res, 200, { id: user.id, name: user.name, role: user.role, setup: user.setup ?? null });

    // ---- учётная запись: смена пароля, второй фактор, экстренный доступ, управление пользователями ----
    const readBody = async (): Promise<Record<string, unknown> | null> => {
      try { const b = await readJson(req); return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null; } catch { return null; }
    };
    const commitUser = async (next: UserRecord) => {
      await deps.persistUser?.(next); // сначала в базу: если запись не удалась, в памяти ничего не меняется
      const i = deps.users.findIndex((x) => x.id === next.id);
      if (i < 0) deps.users.push(next); else deps.users[i] = next;
    };
    const endAllLogins = (id: string, exceptCookie?: string) => {
      deps.sessions.destroyUser(id, exceptCookie);
      deps.tokens?.revokeUser(id);
    };
    /** Проверка действующего пароля с общим счётчиком неудач: смена пароля не должна быть лазейкой для подбора. */
    const confirmPassword = async (password: unknown, code?: unknown): Promise<boolean> => {
      const key = `acct:${user.id}`;
      if (deps.throttle.locked(key, now())) return false;
      const ok = typeof password === "string" && password.length <= 256 && (await verifyPassword(password, user.passwordHash)) && (code === undefined || (typeof code === "string" && verifyTotp(user.totpSecret, code, now())));
      if (!ok) { deps.throttle.fail(key, now()); log({ actor: user.id, action: "account.verify.fail" }); }
      else deps.throttle.reset(key);
      return ok;
    };

    if (isPost && url.startsWith("/api/account/")) {
      if (!accountLimiter.allow(user.id)) return send(res, 429, { error: "Слишком много запросов" });
      if (deps.throttle.locked(`acct:${user.id}`, now())) return send(res, 429, { error: "Слишком много неудачных попыток. Подождите 15 минут." });
      const body = await readBody();
      if (!body) return send(res, 400, { error: "Неверный запрос" });

      if (url === "/api/account/password") {
        if (user.setup === "totp") return send(res, 409, { error: "Пароль уже сменён: подключите второй фактор" });
        if (typeof body.next !== "string" || typeof body.current !== "string") return send(res, 400, { error: "Неверный запрос" });
        if (!(await confirmPassword(body.current, body.code))) return send(res, 401, { error: "Неверный текущий пароль или код" });
        const problem = passwordProblem(body.next, body.current, user.username);
        if (problem) return send(res, 400, { error: problem });
        await commitUser({ ...user, passwordHash: await hashPassword(body.next), passwordChangedAt: new Date(now()).toISOString(), ...(user.setup === "password" ? { setup: "totp" as const } : {}) });
        endAllLogins(user.id, bearer ? undefined : token); // остальные входы завершаются; текущий браузерный остаётся
        log({ actor: user.id, action: "account.password.change" });
        return send(res, 200, { ok: true, relogin: !!bearer, setup: user.setup === "password" ? "totp" : (user.setup ?? null) });
      }

      if (url === "/api/account/totp/start") {
        if (user.setup === "password") return send(res, 409, { error: "Сначала смените пароль" });
        if (!(await confirmPassword(body.password))) return send(res, 401, { error: "Неверный пароль" });
        const secret = newTotpSecret();
        await commitUser({ ...user, pendingTotp: secret });
        log({ actor: user.id, action: "account.totp.start" });
        return send(res, 200, { secret, uri: otpauthUri(user.username, secret) });
      }

      if (url === "/api/account/totp/confirm") {
        if (user.setup === "password") return send(res, 409, { error: "Сначала смените пароль" });
        if (!user.pendingTotp) return send(res, 409, { error: "Новый секрет не запрашивали" });
        if (typeof body.code !== "string" || !verifyTotp(user.pendingTotp, body.code, now())) {
          deps.throttle.fail(`acct:${user.id}`, now());
          log({ actor: user.id, action: "account.verify.fail" });
          return send(res, 401, { error: "Неверный код" });
        }
        const { pendingTotp: _p, setup: _s, ...rest } = user;
        await commitUser({ ...rest, totpSecret: user.pendingTotp });
        endAllLogins(user.id, bearer ? undefined : token);
        log({ actor: user.id, action: "account.totp.enroll" });
        return send(res, 200, { ok: true, relogin: !!bearer, setup: null });
      }
      return send(res, 404, { error: "Not found" });
    }

    // ---- экстренный доступ ----
    if (url === "/api/breakglass" || url === "/api/breakglass/end") {
      if (!can(actor, "visit.edit")) return send(res, 403, { error: "Недостаточно прав" });
      if (req.method === "GET" && url === "/api/breakglass")
        return send(res, 200, { active: bg.active(user.id, now()).map((id) => ({ patientId: id, name: patients.find((p) => p.id === id)?.name ?? id, expiresAt: new Date(bg.expiresAt(user.id, id) ?? 0).toISOString() })), reasons: REASONS });
      if (!isPost) return send(res, 404, { error: "Not found" });
      const body = await readBody();
      if (!body) return send(res, 400, { error: "Неверный запрос" });
      if (url === "/api/breakglass/end") {
        if (typeof body.patientId !== "string") return send(res, 400, { error: "Неверный запрос" });
        const ended = bg.end(user.id, body.patientId);
        if (ended) log({ actor: user.id, action: "breakglass.end", target: body.patientId });
        return send(res, 200, { ok: true });
      }
      if (typeof body.pin !== "string" || !/^\d{14}$/.test(body.pin) || !isReason(body.reason)) return send(res, 400, { error: "Укажите ПИН (14 цифр) и причину из списка" });
      if (!breakGlassLimiter.allow(user.id)) return send(res, 429, { error: "Слишком много запросов" }); // считаются только попытки с ПИН нужной формы
      const patient = patients.find((p) => p.pin === body.pin);
      if (!patient) {
        log({ actor: user.id, action: "breakglass.denied", detail: { reason: body.reason } }); // введённый ПИН в журнал не пишется
        return send(res, 404, { error: "Пациент не найден" });
      }
      if (actor.assignedPatients.includes(patient.id)) return send(res, 409, { error: "Этот пациент уже закреплён за вами" });
      if (bg.grant(user.id, patient.id, now()) === "limit") return send(res, 429, { error: "Одновременно можно открыть не больше трёх карт" });
      log({ actor: user.id, action: "breakglass.start", target: patient.id, detail: { reason: body.reason, minutes: GRANT_MS / 60_000 } });
      return send(res, 200, { patientId: patient.id, name: patient.name, expiresAt: new Date(bg.expiresAt(user.id, patient.id) ?? 0).toISOString() });
    }

    // ---- администратор: пользователи (медицинских данных не видит) ----
    const adminUrl = /^\/api\/admin\/users(?:\/([A-Za-z0-9_-]{1,64})\/(disable|enable|reset|assign))?$/.exec(url);
    if (adminUrl) {
      if (!can(actor, "user.manage")) return send(res, 403, { error: "Недостаточно прав" });
      const [, targetId, op] = adminUrl;
      if (req.method === "GET" && !targetId) return send(res, 200, { users: deps.users.map(publicUser), patientIds: patients.map((p) => p.id) });
      if (!isPost) return send(res, 404, { error: "Not found" });
      const body = await readBody();
      if (!body) return send(res, 400, { error: "Неверный запрос" });
      const knownPatients = (x: unknown): string[] | null =>
        Array.isArray(x) && x.length <= 500 && x.every((i) => typeof i === "string" && patients.some((p) => p.id === i)) ? [...new Set(x as string[])] : null;

      if (!targetId) { // создание
        const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const assigned = body.assignedPatients === undefined ? [] : knownPatients(body.assignedPatients);
        if (!USERNAME.test(username) || name.length < 1 || name.length > 100 || !ROLES.includes(body.role as never) || !assigned) return send(res, 400, { error: "Неверные данные пользователя" });
        if (body.role !== "doctor" && assigned.length) return send(res, 400, { error: "Пациентов закрепляют только за врачами" });
        if (deps.users.some((u) => u.username.toLowerCase() === username)) return send(res, 409, { error: "Такое имя уже занято" });
        const password = tempPassword();
        const totpSecret = newTotpSecret();
        const created: UserRecord = { id: `u-${randomBytes(8).toString("hex")}`, username, name, role: body.role as UserRecord["role"], passwordHash: await hashPassword(password), totpSecret, assignedPatients: assigned, setup: "password" };
        await commitUser(created);
        log({ actor: user.id, action: "user.create", target: created.id, detail: { role: created.role } });
        // Одноразовый пароль и секрет показываются один раз; при первом входе пользователь обязан сменить пароль и заново подключить второй фактор.
        return send(res, 200, { user: publicUser(created), tempPassword: password, totpSecret, uri: otpauthUri(username, totpSecret) });
      }

      const target = deps.users.find((u) => u.id === targetId);
      if (!target) return send(res, 404, { error: "Пользователь не найден" });
      if (op === "disable" || op === "reset") {
        if (target.id === user.id) return send(res, 409, { error: "Нельзя применить к своей записи" });
      }
      if (op === "disable") {
        await commitUser({ ...target, disabled: true });
        endAllLogins(target.id); bg.endAll(target.id);
        log({ actor: user.id, action: "user.disable", target: target.id });
        return send(res, 200, { user: publicUser({ ...target, disabled: true }) });
      }
      if (op === "enable") {
        await commitUser({ ...target, disabled: false });
        log({ actor: user.id, action: "user.enable", target: target.id });
        return send(res, 200, { user: publicUser({ ...target, disabled: false }) });
      }
      if (op === "reset") { // забытый пароль или потерянный телефон
        const password = tempPassword();
        const newSecret = body.resetTotp === true ? newTotpSecret() : null;
        const next: UserRecord = { ...target, passwordHash: await hashPassword(password), setup: "password", pendingTotp: undefined, ...(newSecret ? { totpSecret: newSecret } : {}) };
        delete next.pendingTotp;
        await commitUser(next);
        endAllLogins(target.id); bg.endAll(target.id);
        log({ actor: user.id, action: "user.reset", target: target.id, detail: { totp: newSecret !== null } });
        return send(res, 200, { user: publicUser(next), tempPassword: password, ...(newSecret ? { totpSecret: newSecret, uri: otpauthUri(target.username, newSecret) } : {}) });
      }
      if (op === "assign") {
        const assigned = knownPatients(body.patients);
        if (!assigned || target.role !== "doctor") return send(res, 400, { error: "Неверные данные" });
        await commitUser({ ...target, assignedPatients: assigned });
        log({ actor: user.id, action: "user.assign", target: target.id, detail: { count: assigned.length } });
        return send(res, 200, { user: publicUser({ ...target, assignedPatients: assigned }) });
      }
      return send(res, 404, { error: "Not found" });
    }

    if (req.method === "GET" && url === "/api/audit/verify") {
      if (!can(actor, "audit.verify")) return send(res, 403, { error: "Недостаточно прав" });
      log({ actor: user.id, action: "audit.verify" });
      return send(res, 200, verifyChain(deps.audit));
    }
    if (req.method === "GET" && url === "/api/audit/alerts") {
      if (!can(actor, "audit.verify")) return send(res, 403, { error: "Недостаточно прав" });
      log({ actor: user.id, action: "audit.alerts" });
      const list = deps.audit.filter(isAlert).slice(-100).reverse().map((r) => ({ time: r.time, rule: r.action.slice(6), key: r.target ?? "", count: Number(r.detail?.count ?? 0) }));
      return send(res, 200, { alerts: list });
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

    // ---- пациенты: только те, кто закреплён за вошедшим врачом ----
    if (req.method === "GET" && url === "/api/patients") {
      if (!can(actor, "patient.read")) return send(res, 403, { error: "Недостаточно прав" });
      const mine = patients.filter((p) => canAccessPatient(actor, "patient.read", p.id));
      log({ actor: user.id, action: "patient.list", detail: { count: mine.length } });
      return send(res, 200, { patients: mine.map((p) => ({ id: p.id, name: p.name, birthDate: p.birthDate, pin: p.pin, allergies: p.allergies })) });
    }

    // ---- приёмы: расшифровка, черновик и решения врача хранит сервер ----
    const HISTORY_LIMIT = 100;
    const visitUrl = /^\/api\/visits(?:\/([0-9a-f]{32}))?(?:\/(transcript|extract|decisions|sign))?$/.exec(url);
    if (visitUrl) {
      const [, visitId, action] = visitUrl;

      // История: приёмы самого врача и только по тем пациентам, к которым у него есть доступ. Текста в ответе нет.
      if (req.method === "GET" && !visitId && !action) {
        if (!can(actor, "visit.edit")) return send(res, 403, { error: "Недостаточно прав" });
        const list = (await visits.listByOwner(user.id, HISTORY_LIMIT)).flatMap((v) => {
          const p = patients.find((x) => x.id === v.patientId);
          return p && canAccessPatient(actor, "visit.edit", v.patientId) ? [toSummary(v, p)] : [];
        });
        log({ actor: user.id, action: "visit.list", detail: { count: list.length } });
        return send(res, 200, { visits: list });
      }

      if (isPost && !visitId && !action) {
        if (!can(actor, "visit.edit")) return send(res, 403, { error: "Недостаточно прав" });
        let body: { patientId?: unknown; docType?: unknown; demo?: unknown };
        try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверные данные запроса" }); }
        if (typeof body.patientId !== "string" || !isDocType(body.docType) || (body.demo !== undefined && typeof body.demo !== "boolean"))
          return send(res, 400, { error: "Неверные данные запроса" });
        const patient = patients.find((p) => p.id === body.patientId);
        if (!patient || !canAccessPatient(actor, "visit.edit", body.patientId)) {
          log({ actor: user.id, action: "visit.denied", target: String(body.patientId).slice(0, 32) });
          return send(res, 403, { error: "Нет доступа к этому пациенту" });
        }
        if ((await visits.countDrafts(user.id)) >= MAX_OPEN_PER_USER) return send(res, 429, { error: "Слишком много незавершённых приёмов" });
        const v = createVisit(user.id, body.patientId, body.docType, body.demo === true, new Date(now()).toISOString());
        await visits.save(v);
        log({ actor: user.id, action: "visit.create", target: v.id, detail: { source: v.source, docType: v.docType } });
        return send(res, 200, toView(v, patient));
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
          return send(res, 200, toView(v, patient));
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
            return send(res, 200, toView(v, patient));
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
              return send(res, 200, toView(v, patient));
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
            return send(res, 200, toView(v, patient));
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
            return send(res, 200, toView(v, patient));
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
