import { supabase } from "@/integrations/supabase/client";

/**
 * Generate a hero image via the WaveSpeed-backed edge function.
 * Returns the image URL, or null on any failure (caller should fall back).
 */
export async function generateImage(prompt: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-image", {
      body: { prompt },
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
