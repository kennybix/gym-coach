export default function CoachPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">COACH</h1>
      <div className="bg-panel border border-line rule-volt p-5 rise" style={{ animationDelay: "80ms" }}>
        <p className="text-dim text-sm leading-relaxed">
          Chat + the weekly review card connect here once the LLM key is configured on the
          server. The agent, safety gate, and review pipeline are already live behind
          <span className="font-display text-volt"> /coach</span>.
        </p>
      </div>
    </div>
  );
}
