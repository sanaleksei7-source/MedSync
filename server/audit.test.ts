import { appendRecord, parseLines, toLine, verifyChain, type AuditRecord } from "./audit";

const mk = () => {
  const c: AuditRecord[] = [];
  appendRecord(c, { time: "2026-11-24T10:00:00Z", actor: "u1", action: "login.ok" });
  appendRecord(c, { time: "2026-11-24T10:01:00Z", actor: "u1", action: "document.sign", target: "p1", detail: { docType: "spravka" } });
  appendRecord(c, { time: "2026-11-24T10:02:00Z", actor: "u1", action: "logout" });
  return c;
};

const t: [string, boolean][] = [];
t.push(["valid chain verifies", verifyChain(mk()).ok]);
t.push(["empty chain verifies", verifyChain([]).ok]);

const edited = mk();
edited[1].actor = "u2";
t.push(["edited record detected", !verifyChain(edited).ok]);

const removed = mk();
removed.splice(1, 1);
t.push(["removed record detected", !verifyChain(removed).ok]);

const truncatedHead = mk().slice(1);
t.push(["removed first record detected", !verifyChain(truncatedHead).ok]);

const reordered = mk();
[reordered[0], reordered[1]] = [reordered[1], reordered[0]];
t.push(["reordered detected", !verifyChain(reordered).ok]);

const rehashed = mk();
rehashed[1].detail = { docType: "osmotr" };
t.push(["edit without rehash detected", !verifyChain(rehashed).ok]);

const text = mk().map(toLine).join("");
t.push(["jsonl roundtrip verifies", verifyChain(parseLines(text)).ok]);
t.push(["append-only: seq increments", mk().map((r) => r.seq).join() === "1,2,3"]);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD audit (${bad})` : `ok audit (${t.length})`);
if (bad) process.exit(1);
