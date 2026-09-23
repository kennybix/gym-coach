"use client";
/* /pair#t=<token> — where the phone's camera app lands after scanning `python pair.py`.
   Reads the token from the URL fragment (never sent to a server), stores it, clears the fragment
   from history, and goes Home. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePairing, savePairing } from "@/lib/pairing";
import PageHeader from "@/components/ui/PageHeader";

export default function PairPage() {
  const router = useRouter();
  const [state, setState] = useState<"working" | "ok" | "bad">("working");

  useEffect(() => {
    const p = parsePairing(window.location.hash || window.location.search);
    window.history.replaceState(null, "", "/pair"); // don't leave the token in history
    if (!p) return setState("bad");
    savePairing(p);
    setState("ok");
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
    const t = setTimeout(() => router.replace("/"), 900);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pairing" title={state === "ok" ? "You're in" : state === "bad" ? "That code didn't work" : "Pairing…"} />
      {state === "ok" && <p className="t-sec">Signed in. Taking you home.</p>}
      {state === "bad" && (
        <div className="space-y-4">
          <p className="t-sec leading-relaxed">The code was incomplete or has expired. Run <span className="font-mono text-bone">python pair.py</span> on your computer again and scan the new code.</p>
          <button onClick={() => router.replace("/settings")} className="btn btn-ghost w-full h-12">Open Setup</button>
        </div>
      )}
    </div>
  );
}
