"use client";
import { useEffect, useRef, useState } from "react";

const R = 130;
const CIRC = 2 * Math.PI * R;

export default function RestTimer({
  seconds,
  exercise,
  nextSet,
  onDone,
}: {
  seconds: number;
  exercise: string;
  nextSet: string;
  onDone: () => void;
}) {
  const [total, setTotal] = useState(seconds);
  const [left, setLeft] = useState(seconds);
  const end = useRef(Date.now() + seconds * 1000);

  useEffect(() => {
    const t = setInterval(() => {
      const remain = Math.max(0, Math.round((end.current - Date.now()) / 1000));
      setLeft(remain);
      if (remain <= 0) {
        clearInterval(t);
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        onDone();
      }
    }, 250);
    return () => clearInterval(t);
  }, [onDone]);

  const addTime = (s: number) => {
    end.current += s * 1000;
    setTotal((v) => v + s);
  };

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const frac = total > 0 ? left / total : 0;

  return (
    <div className="fixed inset-0 z-50 bg-ink/95 backdrop-blur-md flex flex-col items-center justify-center px-6">
      <p className="eyebrow mb-1.5">Rest</p>
      <p className="text-bone/80 text-sm mb-10">{exercise}</p>

      <div className="relative">
        <svg width="300" height="300" viewBox="0 0 300 300" className="-rotate-90">
          <circle cx="150" cy="150" r={R} fill="none" stroke="var(--color-line)" strokeWidth="7" />
          <circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke="var(--color-volt)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - frac)}
            style={{ transition: "stroke-dashoffset 250ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display tnum text-7xl font-bold text-bone">
            {mm}:{ss}
          </span>
        </div>
      </div>

      <p className="text-dim text-sm mt-10">
        Next · <span className="text-bone font-medium">{nextSet}</span>
      </p>

      <div className="flex gap-3 mt-10 w-full max-w-xs">
        <button onClick={() => addTime(15)} className="btn btn-ghost flex-1 h-14">
          +15s
        </button>
        <button onClick={onDone} className="btn btn-primary flex-1 h-14">
          Skip rest
        </button>
      </div>
    </div>
  );
}
