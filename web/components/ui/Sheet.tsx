"use client";
/* Bottom sheet — the ONE way the app takes input outside the workout player. Slides up over the
   current screen, closes on backdrop tap / Escape / the Done action, locks page scroll while
   open, and pads for the gesture bar. Keep contents short: a title, a couple of fields, one
   primary action. */
import { useEffect } from "react";

export default function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  action,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  /* optional right-side header action (e.g. "Done") */
  action?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet scroll-soft"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" />
        {(title || eyebrow || action) && (
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
              {title && <h2 className="t-h2">{title}</h2>}
            </div>
            {action ?? (
              <button onClick={onClose} aria-label="close" className="iconbtn -mr-1 -mt-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
