"use client";
/* Progress photo journal on Trends. Photos are stored on the machine (tailnet-only, auth-gated)
   and shown here over time. Tap one for a full view, an optional coach note (vision feedback —
   disabled for eating-disorder history), and delete. Images load via authed fetch -> object URL
   because <img src> can't send the bearer token. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiGet, apiPost, configured, token } from "@/lib/api";

type Photo = { id: string; date: string; pose: string | null; caption: string | null; coach_note: string | null };

async function downscale(file: File, max = 1280, quality = 0.72): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c.toDataURL("image/jpeg", quality);
}

function AuthImg({ id, className, alt }: { id: string; className?: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true, obj: string | null = null;
    fetch(`${apiBase()}/api/photos/${id}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.blob())
      .then((b) => { if (live) { obj = URL.createObjectURL(b); setUrl(obj); } })
      .catch(() => {});
    return () => { live = false; if (obj) URL.revokeObjectURL(obj); };
  }, [id]);
  return url
    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={alt} className={className} />
    : <div className={`${className} bg-panel2 animate-pulse`} />;
}

export default function ProgressPhotos({ delay = 0 }: { delay?: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!configured()) return;
    apiGet<{ photos: Photo[] }>("/api/photos").then((d) => setPhotos(d.photos)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const image = await downscale(file);
      await apiPost("/api/photos", { image });
      load();
    } catch { /* ignore */ }
    setBusy(false);
  };

  const remove = async (p: Photo) => {
    setPhotos((xs) => xs.filter((x) => x.id !== p.id));
    setOpen(null);
    await apiPost("/api/photos/delete", { id: p.id });
  };

  const getNote = async (p: Photo) => {
    setNoteBusy(true); setNoteMsg(null);
    try {
      const r = await apiPost<{ note: string | null; disabled?: boolean }>("/coach/photo-note", { photo_id: p.id });
      if (r.disabled) setNoteMsg("Photo feedback is turned off for accounts with a history of disordered eating.");
      else if (r.note) { setNoteMsg(r.note); setPhotos((xs) => xs.map((x) => (x.id === p.id ? { ...x, coach_note: r.note } : x))); }
    } catch { setNoteMsg("Couldn't get a note right now."); }
    setNoteBusy(false);
  };

  return (
    <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-3.5">
        <p className="eyebrow">Progress photos</p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-primary h-9 px-4 text-sm">
          {busy ? "Adding…" : "+ Photo"}
        </button>
      </div>

      {photos.length === 0 ? (
        <p className="text-dim text-xs leading-relaxed">Add a photo now and again to see your progress over time. They stay private on your own machine.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <button key={p.id} onClick={() => { setOpen(p); setNoteMsg(p.coach_note); }} className="relative aspect-[3/4] rounded-lg overflow-hidden border border-line">
              <AuthImg id={p.id} alt={`progress ${p.date}`} className="w-full h-full object-cover" />
              <span className="absolute bottom-0 inset-x-0 bg-ink/70 text-[10px] text-bone/90 px-1 py-0.5 text-center">
                {new Date(p.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-end" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[90dvh] overflow-auto scroll-soft" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">{new Date(open.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" })}</p>
              <button onClick={() => setOpen(null)} className="text-dim px-1.5 text-xl leading-none">×</button>
            </div>
            <AuthImg id={open.id} alt={`progress ${open.date}`} className="w-full max-h-[55dvh] object-contain rounded-xl bg-panel2 border border-line" />
            {noteMsg && <p className="text-sm text-bone/85 leading-relaxed mt-3">{noteMsg}</p>}
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => getNote(open)} disabled={noteBusy} className="btn btn-primary flex-1 h-11">
                {noteBusy ? "Looking…" : open.coach_note || noteMsg ? "Refresh coach note" : "Get coach note"}
              </button>
              <button onClick={() => remove(open)} className="btn btn-ghost h-11 px-4 text-alert">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
