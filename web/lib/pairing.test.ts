import { describe, expect, it, beforeEach } from "vitest";
import { parsePairing, savePairing } from "./pairing";
import { routeFor } from "./deeplinks";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.c2lnbmF0dXJl`;
const future = Math.floor(Date.now() / 1000) + 3600;
const good = jwt({ sub: "11111111-1111-1111-1111-111111111111", aud: "authenticated", exp: future });

describe("parsePairing", () => {
  it("reads the token from the QR's /pair#t= URL", () => {
    const p = parsePairing(`https://gym-coach.example.ts.net/pair#t=${good}`);
    expect(p?.token).toBe(good);
    expect(p?.sub).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("reads the Android deep link and a raw token", () => {
    expect(parsePairing(`gymcoach://pair?t=${good}`)?.token).toBe(good);
    expect(parsePairing(`  ${good}\n`)?.token).toBe(good);
  });
  it("rejects expired, subject-less and malformed codes", () => {
    expect(parsePairing(jwt({ sub: "x", exp: Math.floor(Date.now() / 1000) - 10 }))).toBeNull();
    expect(parsePairing(jwt({ aud: "authenticated", exp: future }))).toBeNull();
    expect(parsePairing("https://example.com/not-a-pairing-code")).toBeNull();
    expect(parsePairing("3017620422003")).toBeNull(); // a food barcode is not a login
  });
});

describe("savePairing", () => {
  beforeEach(() => localStorage.clear());
  it("stores the token, drops a stale server override and re-checks onboarding", () => {
    localStorage.setItem("coach_api_base", "https://old.example");
    localStorage.setItem("coach_onboarded", "1");
    savePairing(parsePairing(good)!);
    expect(localStorage.getItem("coach_token")).toBe(good);
    expect(localStorage.getItem("coach_api_base")).toBeNull();
    expect(localStorage.getItem("coach_onboarded")).toBeNull();
  });
});

describe("routeFor", () => {
  it("maps notification and shortcut links to screens", () => {
    expect(routeFor("gymcoach://log/weight")).toBe("/?log=weight");
    expect(routeFor("gymcoach://log/bp/")).toBe("/?log=bp");
    expect(routeFor("gymcoach://workout")).toBe("/workout");
    expect(routeFor("gymcoach://food")).toBe("/nutrition?add=1");
    expect(routeFor("gymcoach://")).toBe("/");
  });
  it("ignores unknown and foreign links", () => {
    expect(routeFor("gymcoach://nope")).toBeNull();
    expect(routeFor("https://evil.example/log/weight")).toBeNull();
  });
});
