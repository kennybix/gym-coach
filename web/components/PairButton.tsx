"use client";
/* "Scan pairing code" — opens the QR scanner, signs the app in from `python pair.py`, and reloads
   Home. Used wherever a token can be missing or dead: first run, the expired banner, Setup. */
import { useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import { parsePairing, savePairing } from "@/lib/pairing";

export default function PairButton({
  className = "btn btn-primary h-11 px-4 text-sm",
  label = "Scan pairing code",
  onPaired,
}: { className?: string; label?: string; onPaired?: () => void }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCode = (code: string) => {
    const p = parsePairing(code);
    if (!p) {
      setErr("That isn't a valid pairing code, or it has expired. Run python pair.py again.");
      setOpen(false);
      return;
    }
    savePairing(p);
    setOpen(false);
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
    if (onPaired) onPaired();
    else window.location.assign("/");
  };

  return (
    <>
      <button onClick={() => { setErr(null); setOpen(true); }} className={className}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M9 9h2v2H9zM13 13h2v2h-2zM13 9h2M9 13v2" />
        </svg>
        {label}
      </button>
      {err && <p className="text-alert text-sm mt-2">{err}</p>}
      {open && <BarcodeScanner mode="qr" onCode={onCode} onClose={() => setOpen(false)} />}
    </>
  );
}
