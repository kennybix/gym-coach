/* gymcoach:// deep links -> app routes. Used by notification taps, home-screen shortcuts and the
   Android app's intent filter (see components/NativeShell.tsx). */
const ROUTES: Record<string, string> = {
  home: "/", coach: "/coach", workout: "/workout", food: "/nutrition?add=1",
  "log/weight": "/?log=weight", "log/bp": "/?log=bp", progress: "/trends", train: "/train",
};

/** gymcoach://log/weight -> "/?log=weight"; unknown or foreign links -> null. */
export function routeFor(url: string): string | null {
  const m = url.match(/^gymcoach:\/\/([^?#]*)/i);
  if (!m) return null;
  const key = m[1].replace(/\/+$/, "").toLowerCase();
  if (key === "") return "/";
  return ROUTES[key] ?? null;
}
