"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [base, setBase] = useState("");
  const [tok, setTok] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBase(localStorage.getItem("coach_api_base") || "http://localhost:8000");
    setTok(localStorage.getItem("coach_token") || "");
  }, []);

  const save = () => {
    localStorage.setItem("coach_api_base", base.trim());
    localStorage.setItem("coach_token", tok.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">SET-UP</h1>
      <div className="bg-panel border border-line rule-volt p-4 space-y-4 rise" style={{ animationDelay: "80ms" }}>
        <label className="block">
          <span className="font-display text-[11px] tracking-[0.2em] text-dim">API BASE URL</span>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="mt-1.5 w-full h-12 bg-panel2 border border-line px-3 text-sm tnum outline-none focus:border-volt"
            placeholder="https://your-vps:8000"
          />
        </label>
        <label className="block">
          <span className="font-display text-[11px] tracking-[0.2em] text-dim">BEARER TOKEN</span>
          <textarea
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            rows={4}
            className="mt-1.5 w-full bg-panel2 border border-line p-3 text-xs tnum outline-none focus:border-volt break-all"
            placeholder="paste your JWT"
          />
        </label>
        <button
          onClick={save}
          className="w-full h-12 bg-volt text-ink font-display font-semibold tracking-[0.2em] active:bg-voltdim"
        >
          {saved ? "SAVED" : "SAVE"}
        </button>
      </div>
      <p className="text-dim text-xs leading-relaxed px-1">
        Single-user app: the token is a JWT signed with your server&apos;s secret. Mint one with
        the dev script in the repo, paste it here once, and install this page to your home screen.
      </p>
    </div>
  );
}
