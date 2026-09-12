"use client";
/* Blood pressure + heart rate on Progress: sparklines, the last readings, and edit/remove via a
   sheet. Logging a NEW reading happens from the "+" sheet (QuickLog.VitalsSheet), not here. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import NumField from "./NumField";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";

export type Vital = {
  id: string; recorded_at: string;
  systolic: number | null; diastolic: number | null; heart_rate: number | null;
  tag: string | null; note: string | null;
};
const TAGS = ["resting", "morning", "post-workout"];

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function VitalsSection({ refreshKey, onLog }: { refreshKey?: number; onLog: () => void }) {
  const [list, setList] = useState<Vital[]>([]);
  const [ready, setReady] = useState(false);
  const [edit, setEdit] = useState<Vital | null>(null);
  const [eSys, setESys] = useState(120);
  const [eDia, setEDia] = useState(80);
  const [eHr, setEHr] = useState(70);
  const [eTag, setETag] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return setReady(true);
    apiGet<{ vitals: Vital[] }>("/api/vitals?limit=50").then((d) => setList(d.vitals)).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(load, [load, refreshKey]);

  const startEdit = (v: Vital) => {
    setEdit(v); setESys(v.systolic ?? 120); setEDia(v.diastolic ?? 80); setEHr(v.heart_rate ?? 70); setETag(v.tag ?? "");
  };
  const saveEdit = () => {
    if (!edit) return;
    const next = { ...edit, systolic: edit.systolic != null ? eSys : null, diastolic: edit.diastolic != null ? eDia : null, heart_rate: edit.heart_rate != null ? eHr : null, tag: eTag || null };
    setList((p) => p.map((x) => (x.id === edit.id ? next : x)));
    void enqueue("/api/vitals/update", { id: edit.id, systolic: next.systolic, diastolic: next.diastolic, heart_rate: next.heart_rate, tag: next.tag, note: edit.note });
    setEdit(null);
  };
  const remove = () => {
    if (!edit) return;
    setList((p) => p.filter((v) => v.id !== edit.id));
    void enqueue("/api/vitals/delete", { id: edit.id });
    setEdit(null);
  };

  const chrono = [...list].reverse();
  const hr = chrono.filter((v) => v.heart_rate != null).map((v) => v.heart_rate as number);
  const bp = chrono.filter((v) => v.systolic != null && v.diastolic != null);
  const sys = bp.map((v) => v.systolic as number);
  const latestBP = bp[bp.length - 1];

  return (
    <section className="rise">
      <div className="flex items-baseline justify-between mb-2">
        <p className="eyebrow">Vitals</p>
        <button onClick={onLog} className="text-xs font-mono text-volt">+ Log reading</button>
      </div>
      {ready && list.length === 0 && <Empty line="No readings yet. Blood pressure and resting heart rate go here." action="Log one" onAction={onLog} compact />}
      {(hr.length >= 2 || sys.length >= 2) && (
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          {sys.length >= 2 && latestBP && (
            <div className="card px-4 py-3">
              <p className="t-sec">Blood pressure</p>
              <div className="flex items-end justify-between gap-2 mt-1">
                <span className="t-num text-2xl leading-none">{latestBP.systolic}/{latestBP.diastolic}</span>
                <div className="flex-1 min-w-0 max-w-[90px]"><Spark values={sys} stroke="var(--color-vitals)" /></div>
              </div>
            </div>
          )}
          {hr.length >= 2 && (
            <div className="card px-4 py-3">
              <p className="t-sec">Heart rate</p>
              <div className="flex items-end justify-between gap-2 mt-1">
                <span className="t-num text-2xl leading-none">{hr[hr.length - 1]}<span className="t-sec font-body font-normal ml-1">bpm</span></span>
                <div className="flex-1 min-w-0 max-w-[90px]"><Spark values={hr} stroke="var(--color-vitals)" /></div>
              </div>
            </div>
          )}
        </div>
      )}
      {list.length > 0 && (
        <div>
          {list.slice(0, showAll ? 50 : 4).map((v) => (
            <button key={v.id} onClick={() => startEdit(v)} className="row">
              <span className="flex-1 min-w-0">
                <span className="tnum text-[15px]">
                  {v.systolic != null && v.diastolic != null ? `${v.systolic}/${v.diastolic}` : ""}
                  {v.systolic != null && v.heart_rate != null ? " · " : ""}
                  {v.heart_rate != null ? `${v.heart_rate} bpm` : ""}
                </span>
                {v.tag && <span className="chip ml-2 px-2 py-0.5 text-[10px] text-dim capitalize">{v.tag}</span>}
                <span className="block t-sec mt-0.5">{fmtWhen(v.recorded_at)}{v.note ? ` · ${v.note}` : ""}</span>
              </span>
              <span className="text-dim">›</span>
            </button>
          ))}
          {list.length > 4 && (
            <button onClick={() => setShowAll((v) => !v)} className="btn btn-quiet w-full h-9 text-xs mt-1">{showAll ? "Show fewer" : `All ${list.length} readings`}</button>
          )}
        </div>
      )}

      <Sheet open={edit != null} onClose={() => setEdit(null)} eyebrow={edit ? fmtWhen(edit.recorded_at) : undefined} title="Edit reading">
        {edit?.systolic != null && (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0"><NumField value={eSys} onChange={setESys} step={1} min={50} max={260} unit="sys" /></div>
            <span className="text-dim text-2xl font-display">/</span>
            <div className="flex-1 min-w-0"><NumField value={eDia} onChange={setEDia} step={1} min={30} max={160} unit="dia" /></div>
          </div>
        )}
        {edit?.heart_rate != null && <div className="mt-3"><NumField value={eHr} onChange={setEHr} step={1} min={30} max={230} unit="bpm" /></div>}
        <div className="flex gap-1.5 flex-wrap mt-3">
          {TAGS.map((t) => (
            <button key={t} onClick={() => setETag((c) => (c === t ? "" : t))} className={`chip px-3 py-1.5 text-xs capitalize ${eTag === t ? "chip-on" : "text-dim"}`}>{t}</button>
          ))}
        </div>
        <button onClick={saveEdit} className="btn btn-primary w-full h-14 mt-5 text-base">Save</button>
        <button onClick={remove} className="btn btn-quiet w-full h-10 mt-1 text-sm text-alert">Remove reading</button>
      </Sheet>
    </section>
  );
}

export function Spark({ values, stroke, w = 90, h = 28 }: { values: number[]; stroke: string; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="block w-full h-auto">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={stroke} />
    </svg>
  );
}
