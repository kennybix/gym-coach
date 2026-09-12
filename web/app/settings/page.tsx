"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import ExportData from "@/components/ExportData";
import ProfileEditor from "@/components/ProfileEditor";
import QueueStatus from "@/components/QueueStatus";
import RemindersCard from "@/components/RemindersCard";
import { isNative, syncHealthConnect } from "@/lib/health";
import { tokenExpiry } from "@/lib/api";
import ThemePicker from "@/components/ThemePicker";
import PageHeader from "@/components/ui/PageHeader";

export default function SettingsPage() {
  const [base, setBase] = useState("");
  const [tok, setTok] = useState("");
  const [saved, setSaved] = useState(false);
  const [native, setNative] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);
  const [hcMsg, setHcMsg] = useState<string | null>(null);

  const [exp, setExp] = useState<Date | null>(null);

  useEffect(() => {
    setBase(localStorage.getItem("coach_api_base") || "");
    setTok(localStorage.getItem("coach_token") || "");
    setNative(isNative());
    setExp(tokenExpiry());
  }, []);

  const syncHealth = async () => {
    setHcBusy(true);
    setHcMsg(null);
    const r = await syncHealthConnect();
    if ("error" in r) {
      setHcMsg(
        r.error === "NotInstalled" ? "Health Connect isn't set up on this phone yet."
        : r.error === "NotSupported" ? "This device doesn't support Health Connect."
        : "Couldn't sync — make sure you granted Health Connect access."
      );
    } else {
      setHcMsg(`Imported ${r.weights} weigh-in${r.weights === 1 ? "" : "s"} and ${r.vitals} vitals reading${r.vitals === 1 ? "" : "s"}.`);
    }
    setHcBusy(false);
  };

  const save = () => {
    localStorage.setItem("coach_api_base", base.trim());
    localStorage.setItem("coach_token", tok.trim());
    setExp(tokenExpiry());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="You · looks · data" title="Setup" />

      <div className="card p-5 rise">
        <p className="eyebrow mb-3">Look</p>
        <ThemePicker />
      </div>

      <QueueStatus />

      <ProfileEditor />

      <RemindersCard />

      <Link href="/programs" className="card p-4 rise flex items-center justify-between active:bg-panel2">
        <span>
          <span className="block text-sm font-medium">My programs</span>
          <span className="block text-dim text-xs mt-0.5">Add, edit, schedule — templates or design one for a goal</span>
        </span>
        <span className="text-dim text-xl">›</span>
      </Link>

      <Link href="/history" className="card p-4 rise flex items-center justify-between active:bg-panel2">
        <span>
          <span className="block text-sm font-medium">Workout history</span>
          <span className="block text-dim text-xs mt-0.5">Browse past sessions and fix their logs</span>
        </span>
        <span className="text-dim text-xl">›</span>
      </Link>

      <div className="card p-5 space-y-5 rise">
        <label className="block">
          <span className="eyebrow">API base URL <span className="text-dim normal-case tracking-normal">· optional</span></span>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="field mt-2 w-full h-12 px-3.5 text-sm tnum outline-none"
            placeholder="Automatic — leave blank to use this site"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="eyebrow">Bearer token</span>
          <textarea
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            rows={4}
            className="field mt-2 w-full p-3.5 text-xs tnum outline-none break-all resize-none"
            placeholder="paste your JWT"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button onClick={save} className="btn btn-primary w-full h-12">
          {saved ? "Saved ✓" : "Save"}
        </button>
        {exp && (
          <p className={`text-xs ${exp.getTime() - Date.now() < 30 * 86400e3 ? "text-alert" : "text-dim"}`}>
            Token valid until {exp.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            {exp.getTime() < Date.now() ? " — expired, paste a fresh one" :
              exp.getTime() - Date.now() < 30 * 86400e3 ? " — expiring soon, mint a fresh one" : ""}
          </p>
        )}
      </div>

      {native && (
        <div className="card p-5 rise space-y-3">
          <div>
            <p className="eyebrow">Health Connect</p>
            <p className="text-dim text-xs mt-1 leading-relaxed">
              Pull your weight, blood pressure and resting heart rate from Health Connect (the last
              90 days) so you don&apos;t have to type them in.
            </p>
          </div>
          <button onClick={syncHealth} disabled={hcBusy} className="btn btn-primary w-full h-11">
            {hcBusy ? "Syncing…" : "Sync from Health Connect"}
          </button>
          {hcMsg && <p className="text-dim text-xs">{hcMsg}</p>}
        </div>
      )}

      <ExportData />

      <p className="text-dim text-xs leading-relaxed px-1">
        Single-user app: the token is a JWT signed with your server&apos;s secret. Mint one with the
        dev script in the repo, paste it here once, and install this page to your home screen.
      </p>
    </div>
  );
}
