"use client";
/* Blood-pressure + heart-rate log on Trends. Event log (many per day), each timestamped
   and editable/removable, through the same idempotent offline queue. The coach can read
   these via get_recent_vitals and reference the trends in its guidance. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import NumField from "./NumField";

type Vital = {
  id: string;
  recorded_at: string;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  tag: string | null;
  note: string | null;
};

const TAGS = ["resting", "morning", "post-workout"];

function fmtValue(v: Vital) {
  const parts: string[] = [];
  if (v.systolic != null && v.diastolic != null) parts.push(`${v.systolic}/${v.diastolic}`);
  if (v.heart_rate != null) parts.push(`${v.heart_rate} bpm`);
  return parts.join("  ·  ") || "—";
}
function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function VitalsCard({ delay = 0 }: { delay?: number }) {
  const [list, setList] = useState<Vital[]>([]);
  const [ready, setReady] = useState(false);

  // new-reading form
  const [logBP, setLogBP] = useState(true);
  const [logHR, setLogHR] = useState(true);
  const [sys, setSys] = useState(120);
  const [dia, setDia] = useState(80);
  const [hr, setHr] = useState(70);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [savedTick, setSavedTick] = useState(false);

  // inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [eSys, setESys] = useState(120);
  const [eDia, setEDia] = useState(80);
  const [eHr, setEHr] = useState(70);
  const [eTag, setETag] = useState("");

  const load = useCallback(() => {
    if (!configured()) return setReady(true);
    apiGet<{ vitals: Vital[] }>("/api/vitals?limit=50")
      .then((d) => setList(d.vitals))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(load, [load]);

  const save = useCallback(async () => {
    if (!logBP && !logHR) return;
    const v: Vital = {
      id: crypto.randomUUID(),
      recorded_at: new Date().toISOString(),
      systolic: logBP ? sys : null,
      diastolic: logBP ? dia : null,
      heart_rate: logHR ? hr : null,
      tag: tag || null,
      note: note.trim() || null,
    };
    setList((p) => [v, ...p]); // optimistic — show it immediately
    setNote("");
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    await enqueue("/api/vitals", v);
    load(); // reconcile with the server (after the write has had its flush)
  }, [logBP, logHR, sys, dia, hr, tag, note, load]);

  const remove = useCallback((id: string) => {
    setList((p) => p.filter((v) => v.id !== id));
    void enqueue("/api/vitals/delete", { id });
  }, []);

  const startEdit = (v: Vital) => {
    setEditId(v.id);
    setESys(v.systolic ?? 120);
    setEDia(v.diastolic ?? 80);
    setEHr(v.heart_rate ?? 70);
    setETag(v.tag ?? "");
  };
  const saveEdit = (v: Vital) => {
    const next = {
      ...v,
      systolic: v.systolic != null ? eSys : null,
      diastolic: v.diastolic != null ? eDia : null,
      heart_rate: v.heart_rate != null ? eHr : null,
      tag: eTag || null,
    };
    setList((p) => p.map((x) => (x.id === v.id ? next : x)));
    void enqueue("/api/vitals/update", {
      id: v.id, systolic: next.systolic, diastolic: next.diastolic,
      heart_rate: next.heart_rate, tag: next.tag, note: v.note,
    });
    setEditId(null);
  };

  // chronological series for the sparklines
  const chrono = [...list].reverse();
  const hrSeries = chrono.filter((v) => v.heart_rate != null).map((v) => v.heart_rate as number);
  const bpReadings = chrono.filter((v) => v.systolic != null && v.diastolic != null);
  const sysSeries = bpReadings.map((v) => v.systolic as number);
  const latestBP = bpReadings[bpReadings.length - 1];

  return (
    <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>
      <p className="eyebrow mb-3.5">Vitals · blood pressure & heart rate</p>

      {/* what to log */}
      <div className="flex gap-2 mb-3">
        <button data-on={logBP} onClick={() => setLogBP((v) => !v)} className="seg h-9 px-4 text-xs flex-1">Blood pressure</button>
        <button data-on={logHR} onClick={() => setLogHR((v) => !v)} className="seg h-9 px-4 text-xs flex-1">Heart rate</button>
      </div>

      {logBP && (
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex-1 min-w-0"><NumField value={sys} onChange={setSys} step={1} min={50} max={260} unit="sys" compact /></div>
          <span className="text-dim text-lg">/</span>
          <div className="flex-1 min-w-0"><NumField value={dia} onChange={setDia} step={1} min={30} max={160} unit="dia" compact /></div>
        </div>
      )}
      {logHR && (
        <div className="mb-2.5"><NumField label="Heart rate" value={hr} onChange={setHr} step={1} min={30} max={230} unit="bpm" /></div>
      )}

      {/* tag */}
      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {TAGS.map((t) => (
          <button key={t} onClick={() => setTag((cur) => (cur === t ? "" : t))} className={`chip px-3 py-1.5 text-xs capitalize ${tag === t ? "border-volt text-volt bg-volt/10" : "text-dim"}`}>
            {t}
          </button>
        ))}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional) — e.g. felt dizzy, after coffee"
        className="field w-full h-11 px-3.5 text-sm outline-none mb-3"
      />

      <button onClick={save} disabled={!logBP && !logHR} className="btn btn-primary w-full h-12">
        {savedTick ? "Saved ✓" : "Log reading"}
      </button>

      {/* trend sparklines */}
      {(hrSeries.length >= 2 || sysSeries.length >= 2) && (
        <div className="grid grid-cols-2 gap-2.5 mt-4">
          {hrSeries.length >= 2 && (
            <div className="field p-3">
              <p className="text-dim text-xs">Heart rate</p>
              <div className="flex items-end justify-between gap-2 mt-1">
                <span className="font-display tnum text-lg font-bold shrink-0">
                  {hrSeries[hrSeries.length - 1]}<span className="text-dim text-xs ml-1">bpm</span>
                </span>
                <div className="flex-1 min-w-0"><Spark values={hrSeries} stroke="var(--color-volt)" /></div>
              </div>
            </div>
          )}
          {sysSeries.length >= 2 && latestBP && (
            <div className="field p-3">
              <p className="text-dim text-xs">Blood pressure</p>
              <div className="flex items-end justify-between gap-2 mt-1">
                <span className="font-display tnum text-lg font-bold shrink-0">
                  {latestBP.systolic}/{latestBP.diastolic}
                </span>
                <div className="flex-1 min-w-0"><Spark values={sysSeries} stroke="var(--color-bone)" /></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* recent readings */}
      {ready && list.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {list.slice(0, 12).map((v) =>
            editId === v.id ? (
              <li key={v.id} className="py-3 space-y-2">
                {v.systolic != null && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NumField value={eSys} onChange={setESys} step={1} min={50} max={260} unit="sys" compact /></div>
                    <span className="text-dim">/</span>
                    <div className="flex-1 min-w-0"><NumField value={eDia} onChange={setEDia} step={1} min={30} max={160} unit="dia" compact /></div>
                  </div>
                )}
                {v.heart_rate != null && (
                  <NumField value={eHr} onChange={setEHr} step={1} min={30} max={230} unit="bpm" compact />
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {TAGS.map((t) => (
                    <button key={t} onClick={() => setETag((c) => (c === t ? "" : t))} className={`chip px-2.5 py-1 text-xs capitalize ${eTag === t ? "border-volt text-volt bg-volt/10" : "text-dim"}`}>{t}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(v)} className="btn btn-primary h-9 px-4 text-xs">Save</button>
                  <button onClick={() => setEditId(null)} className="btn btn-ghost h-9 px-4 text-xs">Cancel</button>
                </div>
              </li>
            ) : (
              <li key={v.id} className="py-2.5 flex items-center gap-2">
                <button onClick={() => startEdit(v)} className="flex-1 text-left min-w-0 active:text-volt">
                  <span className="tnum text-sm text-bone/90">{fmtValue(v)}</span>
                  {v.tag && <span className="chip ml-2 px-2 py-0.5 text-[10px] text-dim capitalize">{v.tag}</span>}
                  <span className="block text-dim text-xs mt-0.5">
                    {fmtWhen(v.recorded_at)}{v.note ? ` · ${v.note}` : ""}
                  </span>
                </button>
                <button onClick={() => remove(v.id)} aria-label="remove reading" className="text-dim hover:text-alert px-2 text-base leading-none shrink-0">×</button>
              </li>
            )
          )}
        </ul>
      )}
      {ready && list.length === 0 && (
        <p className="text-dim text-xs mt-3">No readings yet. Log one above — the coach can see these trends.</p>
      )}
    </div>
  );
}

function Spark({ values, stroke, w = 110, h = 30 }: { values: number[]; stroke: string; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  // Responsive: fill the container width via viewBox so the line never spills out of its box.
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="block w-full h-auto">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={stroke} />
    </svg>
  );
}
