"use client";
/* Setup: the look, your details (a row that opens a sheet), sync, reminders, Health Connect,
   access token (a row that opens a sheet), and your data. Rare tasks live behind rows. */
import { useEffect, useState } from "react";
import ExportData from "@/components/ExportData";
import ProfileEditor from "@/components/ProfileEditor";
import QueueStatus from "@/components/QueueStatus";
import RemindersCard from "@/components/RemindersCard";
import ThemePicker from "@/components/ThemePicker";
import PageHeader from "@/components/ui/PageHeader";
import Sheet from "@/components/ui/Sheet";
import { isNative, syncHealthConnect } from "@/lib/health";
import { apiGet, configured, tokenExpiry } from "@/lib/api";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
type Profile = { sex: string; birth_year: number; height_cm: number; activity_level: string; goal_weight_kg: number; weekly_rate_kg: number };

export default function SettingsPage() {
  const [base, setBase] = useState("");
  const [tok, setTok] = useState("");
  const [saved, setSaved] = useState(false);
  const [native, setNative] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);
  const [hcMsg, setHcMsg] = useState<string | null>(null);
  const [exp, setExp] = useState<Date | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    setBase(localStorage.getItem("coach_api_base") || "");
    setTok(localStorage.getItem("coach_token") || "");
    setNative(isNative());
    setExp(tokenExpiry());
    if (configured()) apiGet<Profile>("/api/profile").then(setProfile).catch(() => {});
  }, [showProfile]);

  const syncHealth = async () => {
    setHcBusy(true); setHcMsg(null);
    const r = await syncHealthConnect();
    if ("error" in r) {
      setHcMsg(r.error === "NotInstalled" ? "Health Connect isn't set up on this phone yet."
        : r.error === "NotSupported" ? "This device doesn't support Health Connect."
        : "Couldn't sync. Make sure you granted Health Connect access.");
    } else {
      setHcMsg(`Imported ${r.weights} weigh-in${r.weights === 1 ? "" : "s"} and ${r.vitals} vitals reading${r.vitals === 1 ? "" : "s"}.`);
    }
    setHcBusy(false);
  };

  const saveToken = () => {
    localStorage.setItem("coach_api_base", base.trim());
    localStorage.setItem("coach_token", tok.trim());
    setExp(tokenExpiry());
    setSaved(true);
    setTimeout(() => { setSaved(false); setShowToken(false); }, 900);
  };

  const year = new Date().getFullYear();
  const expSoon = exp && exp.getTime() - Date.now() < 30 * 86400e3;
  const expired = exp && exp.getTime() < Date.now();

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Look · you · data" title="Setup" />

      <section className="rise">
        <p className="eyebrow mb-3">Look</p>
        <ThemePicker />
      </section>

      <section className="rise">
        <p className="eyebrow mb-1">You</p>
        <button onClick={() => setShowProfile(true)} className="row">
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">Your details</span>
            <span className="block t-sec truncate">
              {profile ? `${cap(profile.sex)} · ${year - profile.birth_year} · ${profile.height_cm} cm · ${cap(profile.activity_level)} · goal ${profile.goal_weight_kg} kg at ${profile.weekly_rate_kg} kg/wk` : "Sex, age, height, activity, goal"}
            </span>
          </span>
          <span className="text-dim">›</span>
        </button>
        <button onClick={() => setShowToken(true)} className="row">
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">{tok ? "Signed in" : "Not signed in"}</span>
            <span className={`block t-sec ${expired || expSoon ? "text-alert" : ""}`}>
              {!tok ? "Paste your access token" : expired ? "Token expired. Paste a fresh one." : exp ? `Token valid until ${exp.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}${expSoon ? " · expiring soon" : ""}` : "Token set"}
            </span>
          </span>
          <span className="text-dim">›</span>
        </button>
      </section>

      <QueueStatus />
      <RemindersCard />

      {native && (
        <div className="card p-5 rise space-y-3">
          <div>
            <p className="eyebrow">Health Connect</p>
            <p className="t-sec mt-1 leading-relaxed">Pull weight, blood pressure and resting heart rate from Health Connect (last 90 days).</p>
          </div>
          <button onClick={syncHealth} disabled={hcBusy} className="btn btn-primary w-full h-12">{hcBusy ? "Syncing…" : "Sync from Health Connect"}</button>
          {hcMsg && <p className="t-sec">{hcMsg}</p>}
        </div>
      )}

      <ExportData />

      <Sheet open={showProfile} onClose={() => setShowProfile(false)} title="Your details">
        <ProfileEditor />
      </Sheet>

      <Sheet open={showToken} onClose={() => setShowToken(false)} eyebrow="Single-user app" title="Access token">
        <p className="t-sec leading-relaxed">A JWT signed with your server's secret. Mint one with the repo's script and paste it here once.</p>
        <label className="block mt-4">
          <span className="eyebrow">Server URL · optional</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} className="field mt-1.5 w-full h-12 px-4 text-sm tnum outline-none" placeholder="Automatic — leave blank" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label className="block mt-3">
          <span className="eyebrow">Token</span>
          <textarea value={tok} onChange={(e) => setTok(e.target.value)} rows={4} className="field mt-1.5 w-full p-3.5 text-xs font-mono outline-none break-all resize-none" placeholder="paste your JWT" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <button onClick={saveToken} className="btn btn-primary w-full h-14 mt-4 text-base">{saved ? "Saved ✓" : "Save"}</button>
      </Sheet>
    </div>
  );
}
