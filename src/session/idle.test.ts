import { IdleState, holdSession, sessionHeld } from "./idle";

let bad = 0;
const check = (name: string, ok: boolean) => {
  console.log(ok ? "ok " : "BAD", name);
  if (!ok) bad++;
};
const MIN = 60_000;

const s = new IdleState(0, 10 * MIN, 1 * MIN);
check("active right after start", s.status(0).state === "active");
check("active at 8 min 59 s", s.status(9 * MIN - 1_000).state === "active");
const w = s.status(9 * MIN);
check("warning starts one minute before the limit", w.state === "warning" && w.secondsLeft === 60);
const w2 = s.status(9 * MIN + 30_500);
check("warning counts down (rounds up)", w2.state === "warning" && w2.secondsLeft === 30);
s.activity(9 * MIN + 40_000);
check("activity during the warning cancels it", s.status(9 * MIN + 41_000).state === "active");
check("the limit counts from the last activity", s.status(9 * MIN + 40_000 + 10 * MIN - 1).state === "warning");
check("expired at the limit", s.status(9 * MIN + 40_000 + 10 * MIN).state === "expired");
s.activity(9 * MIN + 40_000 + 10 * MIN + 1);
check("once expired, activity cannot bring it back", s.status(9 * MIN + 40_000 + 10 * MIN + 2).state === "expired");

const t = new IdleState(0, 45_000, 15_000);
check("short test limits work (45 s, warning at 30 s)", t.status(29_999).state === "active" && t.status(30_000).state === "warning" && t.status(45_000).state === "expired");

check("idleFor measures from the last activity", new IdleState(1_000, MIN, 10_000).idleFor(5_000) === 4_000);

check("not held at the start", !sessionHeld());
const r1 = holdSession();
const r2 = holdSession();
check("held while something holds it", sessionHeld());
r1();
r1();
check("releasing twice does not release the other hold", sessionHeld());
r2();
check("free again after all holds are released", !sessionHeld());

if (bad) process.exit(1);
