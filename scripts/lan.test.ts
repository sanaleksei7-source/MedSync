import { isPrivateIpv4, parseIpv4, pickLanIp } from "./lan";

const t: [string, boolean][] = [];
const nic = (address: string, internal = false, family: "IPv4" | "IPv6" = "IPv4") =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as never;

t.push(["private ranges accepted", ["10.1.2.3", "192.168.0.127", "172.16.0.1", "172.31.255.254"].every(isPrivateIpv4)]);
t.push(["public and odd addresses rejected", ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "127.0.0.1", "169.254.1.1", "1.2.3", "a.b.c.d", "999.1.1.1", ""].every((a) => !isPrivateIpv4(a))]);
t.push(["parse rejects extra text", parseIpv4("192.168.0.1;rm") === null && parseIpv4("192.168.0.1\n10.0.0.1") === null]);
t.push(["prefers 192.168 over 10.x", pickLanIp({ vpn: [nic("10.8.0.2")], wifi: [nic("192.168.0.127")] }) === "192.168.0.127"]);
t.push(["ignores loopback, IPv6 and public", pickLanIp({ lo: [nic("127.0.0.1", true)], v6: [nic("fe80::1", false, "IPv6")], pub: [nic("8.8.8.8")] }) === null]);
t.push(["falls back to another private range", pickLanIp({ a: [nic("10.0.0.5")] }) === "10.0.0.5"]);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD lan (${bad})` : `ok lan (${t.length})`);
if (bad) process.exitCode = 1;
