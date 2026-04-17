import WaveImage from "./WaveImage";
import type { WaveModel } from "@/utils/generateImage";

interface Props {
  prompt: string;
  cacheKey: string;
  alt: string;
  className?: string;
  model?: WaveModel;
}

/**
 * Backwards-compat wrapper around WaveImage for legacy onboarding hero usage.
 */
const OnboardingHero = ({ prompt, cacheKey, alt, className = "", model }: Props) => (
  <WaveImage
    prompt={prompt}
    cacheKey={cacheKey}
    alt={alt}
    model={model}
    rounded="2xl"
    className={`w-full aspect-video border border-border/50 ${className}`}
  />
);

export default OnboardingHero;
