import { cn } from "@/lib/utils";

/** The Sentinel "play route" mark: an O with a route arrow. Inherits currentColor. */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={5.5}
      className={className}
      aria-hidden="true"
    >
      <circle cx="19" cy="45" r="8.5" />
      <path d="M26.5 38.5C32 27 38.5 20.5 48 17" />
      <path d="M38.5 13.5 48.5 16.5 45 26.5" />
    </svg>
  );
}

/** App-icon tile (cobalt squircle with the white mark). `size` is in px; omit it to fill the parent. */
export function BrandMark({ size, className }: { size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Sentinel"
      className={cn("inline-grid shrink-0 place-items-center text-white", className)}
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        borderRadius: size ? size * 0.2237 : "22.37%",
        background: "linear-gradient(180deg, #4169FF, #1A3FE0)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.2)",
      }}
    >
      <BrandGlyph className="h-[60%] w-[60%]" />
    </span>
  );
}
