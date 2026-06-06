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
    return <div className={`bg-panel2 border border-line ${className}`} aria-label={alt} />;
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
