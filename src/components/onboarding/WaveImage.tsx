import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useGeneratedImage } from "@/hooks/useGeneratedImage";
import type { WaveModel } from "@/utils/generateImage";

interface Props {
  prompt: string;
  cacheKey: string;
  alt: string;
  model?: WaveModel;
  className?: string;
  fallbackClassName?: string;
  rounded?: "xl" | "2xl" | "full" | "lg" | "md";
}

const roundedClass = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
} as const;

/**
 * General-purpose WaveSpeed image. Skeleton while loading, fade-in on success,
 * dark gradient fallback on failure. Used for hero banners, avatars, and icons.
 */
const WaveImage = ({
  prompt,
  cacheKey,
  alt,
  model = "wavespeed-ai/flux-dev",
  className = "",
  fallbackClassName = "bg-gradient-to-br from-[#1a1a1a] via-[#0d0d0d] to-[#1a1a1a]",
  rounded = "2xl",
}: Props) => {
  const { url, loading, error } = useGeneratedImage(prompt, cacheKey, true, model);
  const r = roundedClass[rounded];

  return (
    <div className={`relative overflow-hidden ${r} ${className}`}>
      {/* Fallback always behind */}
      <div className={`absolute inset-0 ${r} ${fallbackClassName}`} />
      {loading && !url && (
        <Skeleton className={`absolute inset-0 ${r} bg-white/5`} />
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
    </div>
  );
};

export default WaveImage;
