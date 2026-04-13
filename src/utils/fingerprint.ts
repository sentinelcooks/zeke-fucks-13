/**
 * Device fingerprinting utility.
 * Generates and persists a stable hash so browser restarts don't rotate the device identity.
 */

const FINGERPRINT_CACHE_KEY = "primal-device-fingerprint-v1";

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getPersistentStorage(): Storage | null {
  try {
    const testKey = "__primal_fp_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return localStorage;
  } catch {
    try {
      const testKey = "__primal_fp_test__";
      sessionStorage.setItem(testKey, "1");
      sessionStorage.removeItem(testKey);
      return sessionStorage;
    } catch {
      return null;
    }
  }
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";

    canvas.width = 200;
    canvas.height = 50;

    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Primal FP 🔒", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Primal FP 🔒", 4, 17);

    return canvas.toDataURL();
  } catch {
    return "canvas-error";
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "no-webgl";

    const debugInfo = (gl as WebGLRenderingContext).getExtension(
      "WEBGL_debug_renderer_info"
    );
    if (!debugInfo) return "no-debug-info";

    const vendor = (gl as WebGLRenderingContext).getParameter(
      debugInfo.UNMASKED_VENDOR_WEBGL
    );
    const renderer = (gl as WebGLRenderingContext).getParameter(
      debugInfo.UNMASKED_RENDERER_WEBGL
    );
    return `${vendor}~${renderer}`;
  } catch {
    return "webgl-error";
  }
}

export async function generateDeviceFingerprint(): Promise<string> {
  const storage = getPersistentStorage();
  const cached = storage?.getItem(FINGERPRINT_CACHE_KEY);

  if (cached && /^[a-f0-9]{64}$/.test(cached)) {
    return cached;
  }

  const components = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency?.toString() || "unknown",
    (navigator as any).deviceMemory?.toString() || "unknown",
    navigator.maxTouchPoints?.toString() || "0",
    navigator.platform || "unknown",
    getCanvasFingerprint(),
    getWebGLFingerprint(),
  ];

  const raw = components.join("|");
  const fingerprint = await sha256(raw);
  storage?.setItem(FINGERPRINT_CACHE_KEY, fingerprint);
  return fingerprint;
}
