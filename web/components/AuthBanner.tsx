"use client";
/* Shown when an API call comes back 401 while a token is configured — i.e. the token expired
   (they're minted with a 1-year exp) or was revoked. Without this, the app one day just silently
   stops saving and looks broken. Mounted app-wide in the root layout. */
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AuthBanner() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const on = () => setExpired(true);
    window.addEventListener("coach:auth-expired", on);
    return () => window.removeEventListener("coach:auth-expired", on);
  }, []);

  if (!expired) return null;
  return (
    <div className="fixed inset-x-0 z-50 px-4" style={{ top: "calc(0.5rem + env(safe-area-inset-top))" }}>
      <div className="max-w-md mx-auto card border-alert/60 p-3 flex items-center gap-3">
        <span className="text-alert text-lg shrink-0">⚠</span>
        <p className="text-sm text-bone/90 flex-1 min-w-0">
          Your access token has expired — logging is paused until you paste a new one.
        </p>
        <Link href="/settings" onClick={() => setExpired(false)} className="btn btn-primary h-9 px-3 text-xs shrink-0">
          Fix in Setup
        </Link>
      </div>
    </div>
  );
}
