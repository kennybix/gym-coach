"use client";
/* Per-program editor: /program?id=<program_id>. Without an id there is nothing safe to edit
   (the old no-id editor replaced the WHOLE active set — it silently deactivated parallel
   programs) — so we bounce to the library instead. Client-side because the native app is a
   static export (no server components with dynamic searchParams). */
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProgramEditor from "@/components/ProgramEditor";

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  useEffect(() => {
    if (!id) router.replace("/programs");
  }, [id, router]);
  if (!id) return null;
  return <ProgramEditor programId={id} />;
}

export default function ProgramPage() {
  return (
    <Suspense fallback={<div className="card p-5 h-32 animate-pulse" />}>
      <Inner />
    </Suspense>
  );
}
