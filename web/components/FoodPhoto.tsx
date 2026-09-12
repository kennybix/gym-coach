"use client";
/* Snap a photo of your meal → the coach estimates each item, its portion (grams) and macros →
   you confirm/edit → it logs through the normal food endpoints. Estimates, labelled as such.
   The image is downscaled on-device before upload (small, fast, private). */
import { useRef, useState } from "react";
import { apiPost, parseFoodPhoto, type FoodPhotoItem } from "@/lib/api";
import NumField from "./NumField";

async function downscale(file: File, max = 1024, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export default function FoodPhoto({ date, onClose, onLogged }: { date: string; onClose: () => void; onLogged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<FoodPhotoItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(null); setItems(null);
    try {
      const dataUrl = await downscale(file);
      setPreview(dataUrl);
      const r = await parseFoodPhoto(dataUrl);
      if ("unavailable" in r) setErr("The coach is off right now, so I can't read photos. Try later or log manually.");
      else if (!r.items.length) setErr("I couldn't spot any food in that photo. Try a clearer, closer shot.");
      else setItems(r.items);
    } catch {
      setErr("Couldn't read that image. Try again.");
    }
    setBusy(false);
  };

  const patch = (i: number, p: Partial<FoodPhotoItem>) => setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number) => setItems((xs) => (xs!.length <= 1 ? xs : xs!.filter((_, j) => j !== i)));

  const logAll = async () => {
    for (const it of items!) {
      await apiPost("/api/foods/log", {
        id: crypto.randomUUID(), logged_on: date, name: it.name, brand: null, grams: it.grams,
        kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, fiber_g: it.fiber_g,
      });
    }
    onLogged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[88dvh] overflow-auto scroll-soft" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">Photo a meal</p>
          <button onClick={onClose} className="text-dim px-1.5 text-xl leading-none">×</button>
        </div>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

        {!items && (
          <>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="meal" className="w-full max-h-56 object-contain rounded-xl border border-line bg-panel2" />
            ) : (
              <button onClick={() => fileRef.current?.click()} className="field w-full h-40 flex flex-col items-center justify-center gap-2 text-dim active:text-volt">
                <span className="text-3xl">📷</span>
                <span className="text-sm">Take or choose a photo of your food</span>
              </button>
            )}
            {busy && <p className="text-dim text-sm mt-3">Reading the photo…</p>}
            {err && <p className="text-alert text-xs mt-3">{err}</p>}
            {preview && !busy && (
              <button onClick={() => fileRef.current?.click()} className="btn btn-ghost w-full h-11 mt-3">Use a different photo</button>
            )}
          </>
        )}

        {items && (
          <>
            <p className="text-dim text-xs mb-3">Estimates from the photo — fix anything, then log. Portions are best-guess.</p>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="field p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input value={it.name} onChange={(e) => patch(i, { name: e.target.value })} className="field h-9 flex-1 min-w-0 px-2.5 text-sm font-medium outline-none" />
                    <span className="text-dim text-[11px] shrink-0">{it.confidence === "low" ? "low conf." : ""}</span>
                    <button onClick={() => remove(i)} aria-label="remove" className="text-dim hover:text-alert px-1 text-lg shrink-0">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField value={it.grams ?? 0} onChange={(v) => patch(i, { grams: Math.round(v) })} step={10} min={0} max={5000} unit="g" compact />
                    <NumField value={it.kcal} onChange={(v) => patch(i, { kcal: Math.round(v) })} step={10} min={0} max={5000} unit="kcal" compact />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumField value={it.protein_g ?? 0} onChange={(v) => patch(i, { protein_g: v })} step={1} min={0} max={500} decimals={1} unit="P" compact />
                    <NumField value={it.carbs_g ?? 0} onChange={(v) => patch(i, { carbs_g: v })} step={1} min={0} max={500} decimals={1} unit="C" compact />
                    <NumField value={it.fat_g ?? 0} onChange={(v) => patch(i, { fat_g: v })} step={1} min={0} max={500} decimals={1} unit="F" compact />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-dim text-xs mt-3 text-center">
              Total ~{items.reduce((t, x) => t + (x.kcal || 0), 0)} kcal · estimates
            </p>
            <div className="flex gap-2.5 mt-3">
              <button onClick={() => { setItems(null); setPreview(null); }} className="btn btn-ghost h-12 px-4">Retake</button>
              <button onClick={logAll} className="btn btn-primary flex-1 h-12">Log {items.length} item{items.length === 1 ? "" : "s"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
