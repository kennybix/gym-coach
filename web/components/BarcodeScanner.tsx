"use client";
/* Camera scanner. Uses the native BarcodeDetector API (Chrome/Android WebView) for live scanning;
   always offers manual entry as a fallback (iOS Safari / Firefox lack the API).
   mode="barcode": food barcodes (EAN/UPC) — caller looks the code up via /api/foods/barcode.
   mode="qr":      the pairing QR from `python pair.py` — caller parses it with lib/pairing. */
import { useEffect, useRef, useState } from "react";

export default function BarcodeScanner({
  onCode, onClose, mode = "barcode",
}: { onCode: (code: string) => void; onClose: () => void; mode?: "barcode" | "qr" }) {
  const qr = mode === "qr";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const has = typeof window !== "undefined" && "BarcodeDetector" in window;
    setSupported(has);
    if (!has) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = new Detector({ formats: qr ? ["qr_code"] : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) {
              onCode(codes[0].rawValue);
              return;
            }
          } catch { /* keep scanning */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("Couldn't access the camera — enter the barcode number instead.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode, qr]);

  return (
    <div className="fixed inset-0 z-[70] bg-ink/90 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-sm card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">{qr ? "Scan pairing code" : "Scan barcode"}</p>
          <button onClick={onClose} aria-label="close" className="text-dim text-xl leading-none">×</button>
        </div>
        {supported && !error && (
          <div className="rounded-xl overflow-hidden border border-line aspect-[4/3] bg-black relative">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {qr ? (
              <div className="absolute inset-[18%] border-2 border-volt/80 rounded-2xl" />
            ) : (
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-volt/80" />
            )}
          </div>
        )}
        {(supported === false || error) && (
          <p className="text-dim text-sm">{error || "Live scanning isn't supported in this browser."}</p>
        )}
        {qr && <p className="t-sec mt-3">On your computer run <span className="font-mono text-bone">python pair.py</span> and point the camera at the code.</p>}
        <p className="text-dim text-xs mt-3 mb-2">{qr ? "Or paste a token:" : "Or enter the barcode number:"}</p>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(qr ? e.target.value.trim() : e.target.value.replace(/\D/g, ""))}
            inputMode={qr ? "text" : "numeric"}
            placeholder={qr ? "eyJ…" : "e.g. 3017620422003"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="field flex-1 h-11 px-3.5 text-sm outline-none tnum"
          />
          <button onClick={() => manual && onCode(manual)} disabled={!manual} className="btn btn-primary px-5 text-sm">
            {qr ? "Use" : "Look up"}
          </button>
        </div>
      </div>
    </div>
  );
}
