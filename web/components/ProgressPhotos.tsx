"use client";
/* Progress photo journal on Trends. Photos are stored on the machine (tailnet-only, auth-gated)
   and shown here over time. Tap one for a full view, an optional coach note (vision feedback —
   disabled for eating-disorder history), and delete. Images load via authed fetch -> object URL
   because <img src> can't send the bearer token. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiGet, apiPost, configured, token } from "@/lib/api";
import { captureNativePhoto, downscaleFile, isNative } from "@/lib/photo";
import { localDate } from "@/lib/date";

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
  const [photoDate, setPhotoDate] = useState(localDate());
  const [open, setOpen] = useState<Photo | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  // before/after compare
  const [compareMode, setCompareMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [cmp, setCmp] = useState<{ a: Photo; b: Photo } | null>(null);
  const [cmpNote, setCmpNote] = useState<string | null>(null);
  const [cmpBusy, setCmpBusy] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return;
    apiGet<{ photos: Photo[] }>("/api/photos").then((d) => setPhotos(d.photos)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const upload = async (image: string) => {
    setBusy(true); setErr(null);
    try {
      await apiPost("/api/photos", { image, taken_on: photoDate });
      load();
    } catch {
      setErr("Couldn't save that photo — check Tailscale is on, then try again.");
    }
    setBusy(false);
  };

  const setDate = async (p: Photo, date: string) => {
    setPhotos((xs) => xs.map((x) => (x.id === p.id ? { ...x, date } : x)));
    setOpen((o) => (o && o.id === p.id ? { ...o, date } : o));
    await apiPost("/api/photos/update", { id: p.id, taken_on: date });
    setTimeout(load, 300);
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

  const toggleSel = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : s));
  const openCompare = () => {
    const picked = sel.map((id) => photos.find((p) => p.id === id)).filter(Boolean) as Photo[];
    if (picked.length !== 2) return;
    const [a, b] = [...picked].sort((x, y) => x.date.localeCompare(y.date)); // earlier first
    setCmp({ a, b }); setCmpNote(null);
  };
  const runCompare = async () => {
    if (!cmp) return;
    setCmpBusy(true); setCmpNote(null);
    try {
      const r = await apiPost<{ note: string | null; disabled?: boolean }>("/coach/compare-photos", { a: cmp.a.id, b: cmp.b.id });
      setCmpNote(r.disabled ? "Photo feedback is off for accounts with a history of disordered eating." : r.note);
    } catch { setCmpNote("Couldn't compare right now."); }
    setCmpBusy(false);
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
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="eyebrow">Progress photos</p>
        <div className="flex items-center gap-2 min-w-0">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <input type="date" value={photoDate} max={localDate()} onChange={(e) => setPhotoDate(e.target.value)}
            className="field h-9 px-2 text-xs tnum outline-none min-w-0" title="Date this photo was taken" />
          <button onClick={addPhoto} disabled={busy} className="btn btn-primary h-9 px-3.5 text-sm shrink-0">
            {busy ? "Adding…" : "+ Photo"}
          </button>
        </div>
      </div>
      <p className="text-dim text-[11px] mb-3">Adding an older photo? Set the date first so it lands on the right day.</p>

      {err && <p className="text-alert text-xs mb-3">{err}</p>}

      {photos.length >= 2 && (
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => { setCompareMode((m) => !m); setSel([]); }} className="text-xs text-dim active:text-volt">
            {compareMode ? "Cancel" : "↔ Compare two"}
          </button>
          {compareMode && <span className="text-dim text-[11px]">{sel.length}/2 selected</span>}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-dim text-xs leading-relaxed">Add a photo (camera or gallery) now and again to see your progress over time. They stay private on your own machine.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <button key={p.id} onClick={() => (compareMode ? toggleSel(p.id) : (setOpen(p), setNoteMsg(p.coach_note)))}
              className={`relative aspect-[3/4] rounded-lg overflow-hidden border ${compareMode && sel.includes(p.id) ? "border-volt ring-2 ring-volt" : "border-line"}`}>
              <AuthImg id={p.id} alt={`progress ${p.date}`} className="w-full h-full object-cover" />
              <span className="absolute bottom-0 inset-x-0 bg-ink/70 text-[10px] text-bone/90 px-1 py-0.5 text-center">
                {new Date(p.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </button>
          ))}
        </div>
      )}

      {compareMode && sel.length === 2 && (
        <button onClick={openCompare} className="btn btn-primary w-full h-11 mt-3">Compare these two</button>
      )}

      {cmp && (
        <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-end" onClick={() => setCmp(null)}>
          <div className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[90dvh] overflow-auto scroll-soft" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">Before / after</p>
              <button onClick={() => setCmp(null)} className="text-dim px-1.5 text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[cmp.a, cmp.b].map((p, i) => (
                <div key={p.id}>
                  <AuthImg id={p.id} alt={`progress ${p.date}`} className="w-full aspect-[3/4] object-cover rounded-xl border border-line bg-panel2" />
                  <p className="text-dim text-[11px] text-center mt-1">{i === 0 ? "Before · " : "After · "}{new Date(p.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
              ))}
            </div>
            {cmpNote && <p className="text-sm text-bone/85 leading-relaxed mt-3">{cmpNote}</p>}
            <button onClick={runCompare} disabled={cmpBusy} className="btn btn-primary w-full h-11 mt-4">
              {cmpBusy ? "Comparing…" : cmpNote ? "Compare again" : "Compare with coach"}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-end" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[90dvh] overflow-auto scroll-soft" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-dim text-xs shrink-0">Taken</span>
                <input type="date" value={open.date} max={localDate()} onChange={(e) => setDate(open, e.target.value)}
                  className="field h-9 px-2 text-sm tnum outline-none min-w-0" />
              </div>
              <button onClick={() => setOpen(null)} className="text-dim px-1.5 text-xl leading-none shrink-0">×</button>
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
