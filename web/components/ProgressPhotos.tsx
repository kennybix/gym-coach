"use client";
/* Progress photo journal on Trends. Photos are stored on the machine (tailnet-only, auth-gated)
   and shown here over time. Tap one for a full view, an optional coach note (vision feedback —
   disabled for eating-disorder history), and delete. Images load via authed fetch -> object URL
   because <img src> can't send the bearer token. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiGet, apiPost, configured, token } from "@/lib/api";
import { captureNativePhoto, downscaleFile, isNative } from "@/lib/photo";

type Photo = { id: string; date: string; pose: string | null; caption: string | null; coach_note: string | null };

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
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!configured()) return;
    apiGet<{ photos: Photo[] }>("/api/photos").then((d) => setPhotos(d.photos)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const upload = async (image: string) => {
    setBusy(true); setErr(null);
    try {
      await apiPost("/api/photos", { image });
      load();
    } catch {
      setErr("Couldn't save that photo — check Tailscale is on, then try again.");
    }
    setBusy(false);
  };

  // native: Camera plugin (camera OR gallery). web: file input.
  const addPhoto = async () => {
    if (isNative()) {
      setErr(null);
      const dataUrl = await captureNativePhoto();
      if (dataUrl) await upload(dataUrl);
      return;
    }
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      await upload(await downscaleFile(file));
    } catch {
      setErr("Couldn't read that image. Try another.");
      setBusy(false);
    }
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
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={addPhoto} disabled={busy} className="btn btn-primary h-9 px-4 text-sm">
          {busy ? "Adding…" : "+ Photo"}
        </button>
      </div>

      {err && <p className="text-alert text-xs mb-3">{err}</p>}

      {photos.length === 0 ? (
        <p className="text-dim text-xs leading-relaxed">Add a photo (camera or gallery) now and again to see your progress over time. They stay private on your own machine.</p>
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
          <div className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[90dvh] overflow-auto scroll-soft" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">{new Date(open.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" })}</p>
              <button onClick={() => setOpen(null)} className="text-dim px-1.5 text-xl leading-none">×</button>
            </div>
            <AuthImg id={open.id} alt={`progress ${open.date}`} className="w-full max-h-[55dvh] object-contain rounded-xl bg-panel2 border border-line" />
            {noteMsg && <p className="text-sm text-bone/85 leading-relaxed mt-3">{noteMsg}</p>}
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => getNote(open)} disabled={noteBusy} className="btn btn-primary flex-1 h-11">
                {noteBusy ? "Analyzing…" : open.coach_note || noteMsg ? "Re-analyze" : "Analyze & recommend"}
              </button>
              <button onClick={() => remove(open)} className="btn btn-ghost h-11 px-4 text-alert">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
