import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useGeneratedImage } from "@/hooks/useGeneratedImage";

interface Props {
  prompt: string;
  cacheKey: string;
  alt: string;
  className?: string;
}

/**
 * Hero banner for an onboarding screen.
 * Generates a WaveSpeed image; shows a skeleton while loading and a dark
 * gradient fallback if generation fails — the screen never breaks.
 */
const OnboardingHero = ({ prompt, cacheKey, alt, className = "" }: Props) => {
  const { url, loading, error } = useGeneratedImage(prompt, cacheKey);

  return (
    <div
      className={`relative w-full aspect-video rounded-2xl overflow-hidden border border-border/50 ${className}`}
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--primary) / 0.18), hsl(var(--background)) 50%, hsl(var(--nba-cyan) / 0.12))",
      }}
    >
      {loading && !url && (
        <Skeleton className="absolute inset-0 rounded-2xl bg-secondary/40" />
      )}
      {url && !error && (
        <motion.img
          src={url}
          alt={alt}
          draggable={false}
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {/* Bottom fade for text legibility above hero */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
    </div>
  );
};

export default OnboardingHero;
