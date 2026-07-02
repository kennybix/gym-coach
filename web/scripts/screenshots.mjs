/* Visual-QA: screenshot every screen of the served PWA in a phone-sized Chromium, so UI can be
   reviewed/verified without a device. Tests the WEB app (not the native Android WebView) —
   layout, forms, overflow, optimistic UI and flows reproduce here; camera/notifications don't.

   Usage:  TK=<bearer-token> node scripts/screenshots.mjs [baseUrl] [outDir]
   e.g.    TK=$(python mint_token.py <uuid> | awk '/token:/{print $2}') node scripts/screenshots.mjs
*/
import { chromium } from "playwright";

const token = process.env.TK;
const base = process.argv[2] || "http://localhost:3010";
const out = process.argv[3] || "/tmp";
const screens = [
  ["today", "/"], ["trends", "/trends"], ["fuel", "/nutrition"],
  ["coach", "/coach"], ["setup", "/settings"], ["programs", "/programs"],
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
if (token) {
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("coach_token", t); localStorage.setItem("coach_api_base", ""); } catch {}
  }, token);
}
const p = await ctx.newPage();
for (const [name, path] of screens) {
  try {
    await p.goto(base + path, { waitUntil: "domcontentloaded", timeout: 20000 });
    await p.waitForTimeout(2500); // let data load + entrance animations settle
    await p.screenshot({ path: `${out}/shot_${name}.png`, fullPage: true });
    console.log("shot", name, "->", `${out}/shot_${name}.png`);
  } catch (e) {
    console.log("shot", name, "FAILED", String(e).slice(0, 120));
  }
}
await b.close();
