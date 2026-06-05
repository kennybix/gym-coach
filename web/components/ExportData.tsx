"use client";
/* Download a full backup of your own data (weight, nutrition, workouts, vitals, program,
   reviews) as JSON, or per-dataset CSV. Everything is fetched once from /api/export. */
import { useCallback, useState } from "react";
import { apiGet } from "@/lib/api";

type Export = {
  exported_at: string;
  weight: Record<string, unknown>[];
  nutrition: Record<string, unknown>[];
  vitals: Record<string, unknown>[];
  workouts: { started_at: string; sets: { name: string; reps: number | null; weight_kg: number | null; logged_at: string }[] }[];
  [k: string]: unknown;
};

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) =>
    v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExportData() {
  const [data, setData] = useState<Export | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const ensure = useCallback(async (): Promise<Export | null> => {
    if (data) return data;
    setBusy(true);
    setErr(false);
    try {
      const d = await apiGet<Export>("/api/export");
      setData(d);
      return d;
    } catch {
      setErr(true);
      return null;
    } finally {
      setBusy(false);
    }
  }, [data]);

  const json = async () => {
    const d = await ensure();
    if (d) download(`gym-coach-backup-${stamp()}.json`, JSON.stringify(d, null, 2), "application/json");
  };

  const csv = async (kind: "weight" | "nutrition" | "vitals" | "workouts") => {
    const d = await ensure();
    if (!d) return;
    let rows: Record<string, unknown>[];
    if (kind === "workouts") {
      rows = d.workouts.flatMap((w) =>
        w.sets.map((s) => ({ date: w.started_at, exercise: s.name, weight_kg: s.weight_kg, reps: s.reps, logged_at: s.logged_at }))
      );
    } else {
      rows = d[kind] as Record<string, unknown>[];
    }
    download(`gym-coach-${kind}-${stamp()}.csv`, toCSV(rows), "text/csv");
  };

  return (
    <div className="card p-5 rise">
      <p className="eyebrow mb-1.5">Your data</p>
      <p className="text-dim text-xs mb-4 leading-relaxed">
        Download a complete backup. JSON is the full record; CSVs are per dataset for spreadsheets.
      </p>
      <button onClick={json} disabled={busy} className="btn btn-primary w-full h-12">
        {busy ? "Preparing…" : "Download full backup (JSON)"}
      </button>
      <div className="flex flex-wrap gap-2 mt-3">
        {(["weight", "nutrition", "workouts", "vitals"] as const).map((k) => (
          <button key={k} onClick={() => csv(k)} disabled={busy} className="chip px-3.5 py-2 text-xs text-bone/90 capitalize active:border-volt active:text-volt">
            {k}.csv
          </button>
        ))}
      </div>
      {err && <p className="text-alert text-xs mt-3">Couldn&apos;t reach the server — try again when online.</p>}
    </div>
  );
}
