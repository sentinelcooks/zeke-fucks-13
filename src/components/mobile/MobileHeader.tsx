import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  /** Up to two letters for the profile button; falls back to a generic label. */
  initials?: string;
}

/** Page scroll position, from the window or the layout's scrolling <main>. */
function useScrolledPastTop(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target;
      // Ignore horizontal scrollers (chip rows, carousels) inside the page.
      const el = target === document
        ? document.scrollingElement
        : target instanceof HTMLElement && target.tagName === "MAIN" ? target : null;
      if (el) setScrolled(el.scrollTop > threshold);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [threshold]);

  return scrolled;
}

/**
 * Sticky header shared by every dashboard tab: a monospace date eyebrow
 * ("MON · SEP 28") over a large uppercase screen title, with the profile
 * button (opens Settings) on the right. Transparent at the top of the page so
 * it sits on the screen's own backdrop; frosted once content scrolls under it.
 */
export function MobileHeader({ title, initials }: MobileHeaderProps) {
  const navigate = useNavigate();
  const scrolled = useScrolledPastTop();
  const now = new Date();
  const dateStr = `${now.toLocaleDateString("en-US", { weekday: "short" })} · ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <header
      className={`sticky top-0 z-40 pt-safe transition-[background-color,box-shadow] duration-200 ${
        scrolled ? "ios-blur shadow-[inset_0_-0.5px_0_hsl(var(--hairline))]" : "bg-transparent"
      }`}
    >
      <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{dateStr}</p>
          <h1 className="truncate text-[30px] font-black uppercase leading-tight tracking-tight text-foreground">{title}</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/settings")}
          aria-label="Settings and account"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-[15px] font-bold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))] active:scale-95"
        >
          {initials || "Me"}
        </button>
      </div>
    </header>
  );
}
