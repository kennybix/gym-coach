"use client";
/* Animates an exercise by cross-fading between its start/end frames (free-exercise-db ships
   2 images per movement). Both frames are mounted so there's no fetch-flicker on the loop. */
import { useEffect, useState } from "react";

export default function ExerciseAnimation({
  frames,
  alt,
  className = "",
  intervalMs = 750,
}: {
  frames: string[];
  alt: string;
  className?: string;
  intervalMs?: number;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (frames.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % frames.length), intervalMs);
    return () => clearInterval(t);
  }, [frames.length, intervalMs]);

  if (frames.length === 0) {
    // no catalog image (e.g. kegels / custom moves) — a subtle dumbbell placeholder beats a blank box
    return (
      <div className={`bg-panel2 border border-line flex items-center justify-center ${className}`} aria-label={alt}>
        <svg width="38%" height="38%" viewBox="0 0 24 24" fill="none" stroke="var(--color-dim)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-panel2 ${className}`}>
      {frames.map((src, idx) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={idx}
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: idx === i ? 1 : 0 }}
        />
      ))}
    </div>
  );
}
