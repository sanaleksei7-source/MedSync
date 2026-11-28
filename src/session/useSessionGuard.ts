import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { HEARTBEAT_MS, IDLE_LIMIT_MS, IDLE_WARN_MS } from "./config";
import { IdleState, sessionHeld } from "./idle";

export type SignOutReason = "idle" | "expired" | "other";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
export const CHANNEL = "medsync-session";

/**
 * Следит за бездействием на общем ноутбуке. Возвращает, сколько секунд осталось до выхода (во время предупреждения), иначе null.
 * Пока врач работает, раз в несколько минут сообщает серверу, что сессия жива. Вкладки одного браузера обмениваются только
 * сигналами «человек работает» (без данных), чтобы активная вкладка не позволяла соседней выйти из общей сессии.
 */
export function useSessionGuard(enabled: boolean, signOut: (reason: SignOutReason) => void): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const out = useRef(signOut);
  out.current = signOut;

  useEffect(() => {
    if (!enabled) {
      setSecondsLeft(null);
      return;
    }
    const idle = new IdleState(Date.now(), IDLE_LIMIT_MS, IDLE_WARN_MS);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    let lastBeat = Date.now();
    let lastShared = 0;

    const touch = () => {
      const now = Date.now();
      idle.activity(now);
      if (channel && now - lastShared > 5_000) {
        lastShared = now;
        channel.postMessage({ t: "activity" });
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.t === "activity") idle.activity(Date.now());
    };
    channel?.addEventListener("message", onMessage);
    for (const ev of EVENTS) window.addEventListener(ev, touch, { passive: true });

    const timer = setInterval(() => {
      const now = Date.now();
      if (sessionHeld()) idle.activity(now); // идёт запись разговора: врач говорит, а не нажимает кнопки
      const st = idle.status(now);
      if (st.state === "expired") {
        clearInterval(timer);
        out.current("idle");
        return;
      }
      setSecondsLeft(st.state === "warning" ? st.secondsLeft : null);
      if (st.state === "active" && idle.idleFor(now) < HEARTBEAT_MS && now - lastBeat >= HEARTBEAT_MS) {
        lastBeat = now;
        api("GET", "/api/me").catch((e) => {
          if (e instanceof ApiError && e.status === 401) out.current("expired");
        });
      }
    }, 1_000);

    return () => {
      clearInterval(timer);
      for (const ev of EVENTS) window.removeEventListener(ev, touch);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [enabled]);

  return secondsLeft;
}
