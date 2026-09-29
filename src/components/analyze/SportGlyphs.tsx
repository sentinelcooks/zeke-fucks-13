import type { SVGProps } from "react";

/**
 * Monochrome line icons for the Analyze sport chips. Drawn with currentColor
 * so each icon takes its chip's text color (white on the active chip, muted
 * otherwise) instead of the multi-color league logos.
 */
type GlyphProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function BasketballGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18" />
      <path d="M5.6 5.6c3.2 2.6 3.2 10.2 0 12.8M18.4 5.6c-3.2 2.6-3.2 10.2 0 12.8" />
    </Glyph>
  );
}

export function BaseballGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 4.6c1.9 2 2.9 4.5 2.9 7.4S8.9 17.4 7 19.4M17 4.6c-1.9 2-2.9 4.5-2.9 7.4s1 5.4 2.9 7.4" />
    </Glyph>
  );
}

export function FootballGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx="12" cy="12" rx="9.5" ry="5.8" transform="rotate(-40 12 12)" />
      <path d="M9.5 14.5l5-5M11 10.5l1.2 1.2M12.4 9.1l1.2 1.2M9.7 11.9l1.2 1.2" />
    </Glyph>
  );
}

export function HockeyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9 3l2.6 12.5a2.5 2.5 0 0 0 2.4 2H20" />
      <path d="M4 19.5h4" />
    </Glyph>
  );
}

export function GloveGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M7 13V8.5A4.5 4.5 0 0 1 11.5 4h2A4.5 4.5 0 0 1 18 8.5V13a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z" />
      <path d="M7 11.5H5.8A1.8 1.8 0 0 0 4 13.3v0A1.8 1.8 0 0 0 5.8 15H7" />
      <path d="M9 17v3h6v-3" />
    </Glyph>
  );
}
