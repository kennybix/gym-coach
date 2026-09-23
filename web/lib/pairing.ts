/* Pairing: getting an access token onto the phone without typing it.

   The token used to be minted on the desktop and pasted by hand — 195 characters onto a phone. When
   the signing secret was rotated on 2026-09-12 that hand-off was the only way back in, and the app
   sat dead for ten days. Now `python pair.py` on the desktop shows a QR code; the phone scans it
   (in-app scanner, or the camera app, which opens /pair) and is signed in.

   Accepted payloads:
     https://<host>/pair#t=<jwt>     camera-app path (the fragment never reaches any server log)
     gymcoach://pair?t=<jwt>         Android app deep link
     <jwt>                           a raw token (manual paste)
   Validation here is shape + expiry only; the server is the real judge on the first request. */

export type Paired = { token: string; sub: string; exp: Date | null };

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Pull a token out of any accepted payload. Returns null if it isn't a usable token. */
export function parsePairing(raw: string): Paired | null {
  const text = (raw || "").trim();
  let candidate = text;
  const frag = text.match(/[#?&]t=([A-Za-z0-9._-]+)/);
  if (frag) candidate = frag[1];
  if (!JWT.test(candidate)) return null;
  const claims = decodePayload(candidate);
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  const exp = typeof claims.exp === "number" ? new Date(claims.exp * 1000) : null;
  if (exp && exp.getTime() < Date.now()) return null;
  return { token: candidate, sub: claims.sub, exp };
}

/** Store the token and tell the rest of the app it changed. Clears any stale server override so
    the app talks to the origin it was loaded from. */
export function savePairing(p: Paired) {
  try {
    localStorage.setItem("coach_token", p.token);
    localStorage.removeItem("coach_api_base");
    localStorage.removeItem("coach_onboarded"); // re-check onboarding for the (possibly new) account
  } catch {
    /* storage blocked — nothing we can do */
  }
  window.dispatchEvent(new CustomEvent("coach:paired", { detail: { sub: p.sub } }));
}
