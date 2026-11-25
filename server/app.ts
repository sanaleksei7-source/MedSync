import http from "node:http";
import { createHash } from "node:crypto";
import { RateLimiter, hostAllowed, isJson, originAllowed } from "./guards";
import { LoginThrottle, SessionStore, verifyPassword, verifyTotp } from "./auth";
import { appendRecord, verifyChain, type AuditEvent, type AuditRecord } from "./audit";
import { canAccessPatient, can, type Actor, type Role } from "./rbac";
import type { Signer } from "./signer";
import { MAX_SECONDS, MIN_SECONDS, SAMPLE_RATE, SILENCE_RMS, isHallucination, rms, type AsrEngine } from "./asr/engine";
import { findConflicts } from "../src/data/allergy";
import { patients } from "../src/data/patients";
import { finalizeSections, signBlockers, type Decisions } from "../src/domain/rules";
import type { Line, Section } from "../src/data/script";

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
  throttle: LoginThrottle;
  signer: Signer;
  audit: AuditRecord[];
  persistAudit: (r: AuditRecord) => void;
  ipLimitPerMinute?: number;
  asr?: AsrEngine | null; // распознавание речи; null — не настроено
  extract: (docTitle: string, sectionTitles: string[], lines: Line[]) => Promise<Section[]>;
  allowedOrigins: string[];
  allowedHosts?: string[]; // по умолчанию — локальные адреса (guards.hostAllowed)
  secureCookie: boolean;
  dummyHash: string; // для выравнивания времени ответа, когда пользователя не существует
  now?: () => number;
}

const COOKIE = "medsync_session";
const MAX_LINES = 400;

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

function cookieToken(req: http.IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return undefined;
}

const isLine = (l: unknown): l is Line =>
  !!l && typeof l === "object" && Number.isInteger((l as Line).id) && typeof (l as Line).text === "string" &&
  ((l as Line).speaker === "Врач" || (l as Line).speaker === "Пациент");

const isSection = (s: unknown): s is Section =>
  !!s && typeof s === "object" && typeof (s as Section).title === "string" && Array.isArray((s as Section).statements) &&
  (s as Section).statements.every(
    (st) => typeof st?.text === "string" && Array.isArray(st.sourceIds) && st.sourceIds.every((n: unknown) => Number.isInteger(n)),
  );

function isDecisions(d: unknown): d is Decisions {
  if (!d || typeof d !== "object") return false;
  return Object.values(d).every(
    (v) => v && ["kept", "removed", "edited"].includes((v as { action: string }).action) &&
      ((v as { text?: unknown }).text === undefined || typeof (v as { text?: unknown }).text === "string"),
  );
}

export function createHandler(deps: Deps) {
  const now = deps.now ?? Date.now;
  const ipLimiter = new RateLimiter(deps.ipLimitPerMinute ?? 600, 60_000); // клиника может быть за одним внешним адресом
  const loginLimiter = new RateLimiter(20, 60_000);
  const extractLimiter = new RateLimiter(10, 60_000);
  const asrLimiter = new RateLimiter(60, 60_000); // сегмент речи ≈ 5–25 с, 60 в минуту хватает с запасом

  const log = (e: Omit<AuditEvent, "time">) => {
    const rec = appendRecord(deps.audit, { time: new Date(now()).toISOString(), ...e });
    deps.persistAudit(rec);
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = (req.url ?? "").split("?")[0];
    const host = req.headers.host;
    if (!(deps.allowedHosts ? deps.allowedHosts.includes(host ?? "") : hostAllowed(host))) return send(res, 403, { error: "Forbidden" });
    if (!originAllowed(req.headers.origin, deps.allowedOrigins)) return send(res, 403, { error: "Forbidden" });
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
      let body: { username?: unknown; password?: unknown; code?: unknown };
      try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверный запрос" }); }
      const { username, password, code } = body;
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
      const token = deps.sessions.create(user.id, now());
      log({ actor: user.id, action: "login.ok" });
      const cookie = `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${deps.secureCookie ? "; Secure" : ""}`;
      return send(res, 200, { id: user.id, name: user.name, role: user.role }, { "Set-Cookie": cookie });
    }

    // ---- всё остальное требует сессии ----
    const token = cookieToken(req);
    const session = deps.sessions.get(token, now());
    const user = session ? deps.users.find((u) => u.id === session.userId) : undefined;
    if (!user) return send(res, 401, { error: "Требуется вход" });
    const actor: Actor = { id: user.id, role: user.role, assignedPatients: user.assignedPatients };

    if (isPost && url === "/api/logout") {
      deps.sessions.destroy(token);
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
        const text = await deps.asr.transcribe(pcm);
        if (isHallucination(text)) return send(res, 200, { text: "", dropped: "hallucination" });
        return send(res, 200, { text });
      } catch {
        return send(res, 502, { error: "Сервис распознавания недоступен" }); // детали и текст не раскрываем и не пишем
      }
    }

    if (isPost && url === "/api/extract") {
      if (!can(actor, "extract.run")) return send(res, 403, { error: "Недостаточно прав" });
      if (!extractLimiter.allow(user.id)) return send(res, 429, { error: "Слишком много запросов, подождите минуту" });
      let body: { docTitle?: unknown; sectionTitles?: unknown; lines?: unknown };
      try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверные данные запроса" }); }
      const { docTitle, sectionTitles, lines } = body;
      if (typeof docTitle !== "string" || !Array.isArray(sectionTitles) || !sectionTitles.every((t) => typeof t === "string") ||
          !Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES || !lines.every(isLine))
        return send(res, 400, { error: "Неверные данные запроса" });
      log({ actor: user.id, action: "extract.request", detail: { lines: lines.length } });
      try {
        return send(res, 200, { sections: await deps.extract(docTitle, sectionTitles as string[], lines) });
      } catch (e) {
        console.error(e);
        return send(res, 502, { error: e instanceof Error && e.message ? e.message : "Ошибка модели" });
      }
    }

    if (isPost && url === "/api/sign") {
      let body: { patientId?: unknown; docType?: unknown; lines?: unknown; sections?: unknown; decisions?: unknown; ackAllergy?: unknown };
      try { body = (await readJson(req)) as typeof body; } catch { return send(res, 400, { error: "Неверные данные запроса" }); }
      const { patientId, docType, lines, sections, decisions, ackAllergy } = body;
      if (typeof patientId !== "string" || typeof docType !== "string" || !Array.isArray(lines) || lines.length > MAX_LINES || !lines.every(isLine) ||
          !Array.isArray(sections) || !sections.every(isSection) || !isDecisions(decisions) ||
          !Array.isArray(ackAllergy) || !ackAllergy.every((n) => Number.isInteger(n)))
        return send(res, 400, { error: "Неверные данные запроса" });

      if (!canAccessPatient(actor, "document.sign", patientId)) {
        log({ actor: user.id, action: "document.sign.denied", target: patientId });
        return send(res, 403, { error: "Нет доступа к этому пациенту" });
      }
      const patient = patients.find((p) => p.id === patientId);
      if (!patient) return send(res, 404, { error: "Пациент не найден" });

      // Правила проверяются на сервере заново — данным клиента о «проверено» не доверяем.
      const conflicts = findConflicts(patient.allergies, lines);
      const blockers = signBlockers(sections, decisions, conflicts, ackAllergy as number[], () => true);
      if (blockers.unchecked.length || blockers.allergy.length) {
        log({ actor: user.id, action: "document.sign.blocked", target: patientId, detail: { unchecked: blockers.unchecked.length, allergy: blockers.allergy.length } });
        return send(res, 409, { error: "Документ нельзя подписать: есть непроверенные факты или конфликт с аллергией", blockers });
      }
      const final = finalizeSections(sections, decisions);
      const canonical = [docType, patient.pin, ...final.flatMap((s) => [s.title, ...s.lines])].join("\n");
      const hash = createHash("sha256").update(canonical).digest("hex");
      const signature = deps.signer.sign(hash);
      const signedAt = new Date(now()).toISOString();
      // В журнал — только идентификаторы и хэш, без текста документа.
      log({ actor: user.id, action: "document.sign", target: patientId, detail: { docType, hash, scheme: deps.signer.scheme } });
      return send(res, 200, { hash, signature, signedAt, signer: user.name, scheme: deps.signer.scheme, demo: deps.signer.demo });
    }

    return send(res, 404, { error: "Not found" });
  };
}
