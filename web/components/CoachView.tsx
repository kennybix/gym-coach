"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  coachChat,
  coachConfirm,
  coachLatestReview,
  configured,
  type CoachReply,
  type Review,
} from "@/lib/api";

type Msg = { role: "user" | "coach" | "system"; text: string };
const TKEY = "coach_thread_id";

function threadId(): string {
  let t = localStorage.getItem(TKEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TKEY, t);
  }
  return t;
}

export default function CoachView() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ reason: string } | null>(null);
  const [review, setReview] = useState<Review>(null);
  const [ready, setReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(configured());
    if (configured()) coachLatestReview().then(setReview);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, confirm]);

  const handle = useCallback((r: CoachReply) => {
    if (r.kind === "unavailable") {
      setMsgs((m) => [...m, { role: "system", text: "Coach is offline — add your LLM key on the server to enable chat." }]);
    } else if (r.kind === "reply") {
      setMsgs((m) => [...m, { role: "coach", text: r.text }]);
    } else {
      setConfirm({ reason: r.payload.reason });
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      handle(await coachChat(threadId(), text));
    } catch {
      setMsgs((m) => [...m, { role: "system", text: "Couldn't reach the coach. Check your connection." }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, handle]);

  const resolve = useCallback(async (approved: boolean) => {
    setConfirm(null);
    setBusy(true);
    try {
      handle(await coachConfirm(threadId(), approved));
    } finally {
      setBusy(false);
    }
  }, [handle]);

  if (!ready)
    return (
      <Wrap>
        <Card><p className="text-dim text-sm">Set your token on SET-UP to talk to your coach.</p></Card>
      </Wrap>
    );

  return (
    <Wrap>
      {review && (
        <div className="bg-panel border border-line rule-volt p-4 rise">
          <div className="flex items-center justify-between mb-2">
            <p className="font-display text-[11px] tracking-[0.25em] text-dim">THIS WEEK</p>
            <span className="font-display text-[10px] tracking-widest text-volt uppercase">{review.status.replace("_", " ")}</span>
          </div>
          <p className="text-sm text-bone/90 leading-relaxed">{review.summary}</p>
        </div>
      )}

      <div className="space-y-3 min-h-[40dvh]">
        {msgs.length === 0 && (
          <p className="text-dim text-sm text-center py-10">
            Ask your coach anything — how your week went, whether to adjust, what to do with no
            equipment. It reads your actual logs before answering.
          </p>
        )}
        {msgs.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {confirm && (
          <div className="bg-panel2 border border-volt/50 p-4">
            <p className="text-sm text-bone/90 mb-3">{confirm.reason}</p>
            <p className="text-dim text-xs mb-3">This is a sizeable change — confirm to apply it.</p>
            <div className="flex gap-2">
              <button onClick={() => resolve(true)} className="flex-1 h-11 bg-volt text-ink font-display tracking-widest font-semibold active:bg-voltdim">APPROVE</button>
              <button onClick={() => resolve(false)} className="flex-1 h-11 border border-line text-bone font-display tracking-widest active:bg-panel">DECLINE</button>
            </div>
          </div>
        )}
        {busy && <p className="text-dim text-xs tnum pl-1">coach is thinking…</p>}
        <div ref={endRef} />
      </div>

      <div className="fixed bottom-[68px] inset-x-0 border-t border-line bg-ink/95 backdrop-blur">
        <div className="max-w-md mx-auto p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="message your coach"
            className="flex-1 h-12 bg-panel2 border border-line px-3 text-sm outline-none focus:border-volt"
          />
          <button onClick={send} disabled={busy} className="px-5 bg-volt text-ink font-display font-semibold tracking-wider active:bg-voltdim disabled:opacity-40">
            SEND
          </button>
        </div>
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">COACH</h1>
      {children}
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-panel border border-line rule-volt p-4 rise">{children}</div>;
}
function Bubble({ role, text }: { role: Msg["role"]; text: string }) {
  if (role === "system")
    return <p className="text-center text-dim text-xs px-6 py-1">{text}</p>;
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] px-3.5 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-volt/10 border border-volt/40 text-bone" : "bg-panel border border-line text-bone/90"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
