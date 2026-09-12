/* Empty / thin state: one line and (optionally) one action. Never a paragraph, never a "0 / 14". */
export default function Empty({
  line,
  action,
  onAction,
  href,
  compact = false,
}: {
  line: string;
  action?: string;
  onAction?: () => void;
  href?: string;
  compact?: boolean;
}) {
  const btn = action ? (
    href ? (
      <a href={href} className="btn btn-ghost h-10 px-4 text-sm shrink-0">{action}</a>
    ) : (
      <button onClick={onAction} className="btn btn-ghost h-10 px-4 text-sm shrink-0">{action}</button>
    )
  ) : null;
  return (
    <div className={`flex items-center justify-between gap-4 ${compact ? "py-2" : "py-5"}`}>
      <p className="text-dim text-sm leading-snug">{line}</p>
      {btn}
    </div>
  );
}
