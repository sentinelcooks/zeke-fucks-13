import type { ComponentType } from "react";
import { isSportTemporarilyHidden } from "@/lib/sportAvailability";

export interface SportChipOption<T extends string> {
  value: T;
  label: string;
  /** Monochrome line icon (see SportGlyphs.tsx); it takes the chip's text color. */
  icon: ComponentType<{ className?: string }>;
}

interface SportChipsProps<T extends string> {
  options: SportChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Up to this many sports share the row evenly; more than this scrolls. */
const EVEN_ROW_MAX = 5;

/**
 * Capsule chips for the Analyze tab's sport picker. The active chip is filled
 * with the accent color; the rest are outlined cards.
 *
 * With a handful of sports the chips split the row into equal widths, so the
 * row is balanced edge to edge at any phone width. A longer list becomes a
 * horizontal scroller instead of squeezing the labels.
 */
export function SportChips<T extends string>({ options, value, onChange }: SportChipsProps<T>) {
  const visible = options.filter((option) => !isSportTemporarilyHidden(option.value));
  const even = visible.length <= EVEN_ROW_MAX;

  const chips = visible.map((option) => {
    const active = option.value === value;
    const Icon = option.icon;
    return (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(option.value)}
        className={`flex h-11 items-center justify-center gap-1.5 rounded-full text-[13px] font-bold uppercase tracking-[0.02em] transition-colors active:scale-[0.97] ${
          even ? "min-w-0 flex-1 px-2" : "shrink-0 px-4"
        } ${
          active
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]"
        }`}
      >
        {/* On the narrowest phones an even row has no room for icon + label; keep the label. */}
        <Icon className={`h-4 w-4 shrink-0 ${even ? "max-[359px]:hidden" : ""}`} />
        <span className="truncate">{option.label}</span>
      </button>
    );
  });

  if (even) {
    return (
      <div role="tablist" aria-label="Sport" className="flex gap-2">
        {chips}
      </div>
    );
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
      <div role="tablist" aria-label="Sport" className="flex w-max gap-2">
        {chips}
      </div>
    </div>
  );
}

interface UnderlineTabsProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Stretch tabs to fill the row (mode toggle) or size to content (categories). */
  fill?: boolean;
  ariaLabel: string;
}

/** Text tabs over a full-width divider, with an accent underline under the active one. */
export function UnderlineTabs<T extends string>({ options, value, onChange, fill = false, ariaLabel }: UnderlineTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex overflow-x-auto border-b border-hairline scrollbar-hide ${fill ? "" : "gap-5"}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`relative shrink-0 whitespace-nowrap pb-2.5 pt-1 font-semibold transition-colors ${
              fill ? "min-h-[46px] flex-1 text-[15px]" : "min-h-[38px] text-[14px]"
            } ${active ? "text-foreground" : "text-muted-foreground"}`}
          >
            {option.label}
            <span
              aria-hidden
              className={`absolute bottom-[-1px] left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-primary transition-all ${
                active ? (fill ? "w-[70%]" : "w-full") : "w-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
