"use client";
/* Shows how many writes are waiting in the offline queue, with a manual "Sync now". Gives the
   user confidence their logs are saved — and a recovery path if something is stuck. */
import { useEffect, useState } from "react";
import { flush, subscribeQueue } from "@/lib/queue";

export default function QueueStatus() {
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeQueue(setN), []);

  const sync = async () => {
    setBusy(true);
    await flush();
    setBusy(false);
  };

  return (
    <div className="card p-4 rise flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {n === 0 ? "All changes synced" : `${n} change${n > 1 ? "s" : ""} waiting to sync`}
        </p>
        <p className="text-dim text-xs mt-0.5 leading-snug">
          {n === 0 ? "Your logs are saved to the server." : "Make sure Tailscale is on, then sync."}
        </p>
      </div>
      <button onClick={sync} disabled={busy} className="btn btn-ghost h-9 px-3 text-sm shrink-0">
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
