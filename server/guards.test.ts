import { DEFAULT_ORIGINS, RateLimiter, hostAllowed, isJson, originAllowed } from "./guards";

const checks: [string, boolean][] = [
  ["no origin ok", originAllowed(undefined, DEFAULT_ORIGINS)],
  ["own origin ok", originAllowed("http://localhost:5173", DEFAULT_ORIGINS)],
  ["foreign origin blocked", !originAllowed("https://evil.example", DEFAULT_ORIGINS)],
  ["localhost host ok", hostAllowed("127.0.0.1:8787")],
  ["rebinding host blocked", !hostAllowed("evil.example:8787")],
  ["json ok", isJson("application/json; charset=utf-8")],
  ["form blocked", !isJson("application/x-www-form-urlencoded")],
  ["missing content-type blocked", !isJson(undefined)],
];
const rl = new RateLimiter(2, 1000);
checks.push(["rate 1", rl.allow("a", 0)], ["rate 2", rl.allow("a", 10)], ["rate 3 blocked", !rl.allow("a", 20)]);
checks.push(["other key ok", rl.allow("b", 20)], ["window resets", rl.allow("a", 1500)]);

let bad = 0;
for (const [n, ok] of checks) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD guards (${bad})` : `ok guards (${checks.length})`);
if (bad) process.exit(1);
