import { supabase } from "@/integrations/supabase/client";

export type WaveModel =
  | "wavespeed-ai/flux-dev"
  | "wavespeed-ai/nano-banana-pro"
  | "wavespeed-ai/flux-dev/lora/krea"
  | "wavespeed-ai/flux-dev/image-to-image/ultra-fast";

/**
 * Generate an image via the WaveSpeed-backed edge function.
 * Returns the image URL, or null on any failure (caller should fall back).
 */
export async function generateImage(
  prompt: string,
  model: WaveModel = "wavespeed-ai/flux-dev"
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-image", {
      body: { prompt, model },
    });
    if (error) {
      console.warn("[generateImage] invoke error", error);
      return null;
    }
    return (data as { imageUrl?: string | null })?.imageUrl ?? null;
  } catch (e) {
    console.warn("[generateImage] exception", e);
    return null;
  }
}
