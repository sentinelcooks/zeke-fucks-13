import { useEffect, useState } from "react";
import { generateImage, type WaveModel } from "@/utils/generateImage";

// Module-level cache survives re-renders within a session.
const memCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const SS_PREFIX = "sentinel_img:";

function readSession(key: string): string | null {
  try {
    const v = sessionStorage.getItem(SS_PREFIX + key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeSession(key: string, url: string) {
  try { sessionStorage.setItem(SS_PREFIX + key, url); } catch {}
}

export function useGeneratedImage(
  prompt: string,
  cacheKey: string,
  enabled: boolean = true,
  model: WaveModel = "wavespeed-ai/flux-dev"
) {
  const initial = memCache.get(cacheKey) ?? readSession(cacheKey);
  if (initial && !memCache.has(cacheKey)) memCache.set(cacheKey, initial);

  const [url, setUrl] = useState<string | null>(initial);
  const [loading, setLoading] = useState<boolean>(!initial && enabled);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    if (memCache.has(cacheKey)) {
      setUrl(memCache.get(cacheKey)!);
      setLoading(false);
      return;
    }
    const ss = readSession(cacheKey);
    if (ss) {
      memCache.set(cacheKey, ss);
      setUrl(ss);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    const existing = inflight.get(cacheKey);
    const p = existing ?? generateImage(prompt, model);
    if (!existing) inflight.set(cacheKey, p);

    p.then((result) => {
      if (cancelled) return;
      if (result) {
        memCache.set(cacheKey, result);
        writeSession(cacheKey, result);
        setUrl(result);
      } else {
        setError(true);
      }
    })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => {
        inflight.delete(cacheKey);
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [prompt, cacheKey, enabled, model]);

  return { url, loading, error };
}

/** Fire-and-forget preload (for the next screen). */
export function preloadGeneratedImage(
  prompt: string,
  cacheKey: string,
  model: WaveModel = "wavespeed-ai/flux-dev"
) {
  if (memCache.has(cacheKey)) return;
  if (readSession(cacheKey)) return;
  if (inflight.has(cacheKey)) return;
  const p = generateImage(prompt, model).then((url) => {
    if (url) {
      memCache.set(cacheKey, url);
      writeSession(cacheKey, url);
    }
    return url;
  }).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
}
