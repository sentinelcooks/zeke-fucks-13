import { useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/brand/BrandMark";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  /** Up to two letters for the profile button; falls back to a generic label. */
  initials?: string;
}

/** Sticky glass header: brand mark + screen title, profile button opens Settings. */
export function MobileHeader({ title, initials }: MobileHeaderProps) {
  const navigate = useNavigate();
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <header className="ios-blur sticky top-0 z-40 pt-safe shadow-[inset_0_-0.5px_0_hsl(var(--hairline))]">
      <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={30} />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">{dateStr}</p>
            <h1 className="truncate text-[17px] font-semibold leading-tight text-foreground">{title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/settings")}
          aria-label="Settings and account"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fill/15 text-[15px] font-semibold text-muted-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))] active:scale-95"
        >
          {initials || "Me"}
        </button>
      </div>
    </header>
  );
}
