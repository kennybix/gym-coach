export default function TrendsPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">TRENDS</h1>
      <div className="bg-panel border border-line rule-volt p-5 rise" style={{ animationDelay: "80ms" }}>
        <p className="text-dim text-sm leading-relaxed">
          Weight trend + adherence charts land here next — the backend queries already exist
          (regression slope, prescribed vs completed). Coming in the next build pass.
        </p>
      </div>
    </div>
  );
}
