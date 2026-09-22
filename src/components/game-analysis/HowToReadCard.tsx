import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The single place the model's caveat appears.
 *
 * Every other disclaimer was removed from this screen in the redesign: the
 * hero line, the model-context card and the embedded written analysis each
 * carried their own copy, which trained the eye to skip all of them. One
 * collapsible, at the end, is the whole disclosure.
 *
 * `narrative` is the model's own writeup when it returned one. It sits above
 * the caveat so the reasoning behind the score is still reachable after the
 * standalone context card was dropped.
 */
export function HowToReadCard({ narrative }: { narrative?: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="vision-card overflow-hidden" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground/80"
      >
        How to read this score
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2.5 px-4 pb-4">
          {narrative ? (
            <p className="text-[12px] leading-relaxed text-foreground/70">{narrative}</p>
          ) : null}
          <p className="text-[12px] leading-relaxed text-muted-foreground/65">
            The score shows how strongly the model leans one way. It is not a validated win
            probability, so expected value and unit sizing stay hidden until graded results back it
            up. Check lineups and line movement before betting.
          </p>
        </div>
      )}
    </section>
  );
}
