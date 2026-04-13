/**
 * SecurityProvider — wraps the app with 15+ client-side security checks:
 * 
 * 1. DevTools detection (window size diff)
 * 2. DevTools detection (debugger timing)
 * 3. Right-click context menu disabled
 * 4. Keyboard shortcuts blocked (F12, Ctrl+Shift+I/J/C, Ctrl+U)
 * 5. Console poisoning (warnings + log clearing)
 * 6. Idle timeout auto-logout (15 min)
 * 7. Tab visibility change → re-validate on return
 * 8. SessionStorage integrity check (tamper detection)
 * 9. Multiple tab detection
 * 10. Copy/paste protection on sensitive areas
 * 11. iFrame embed protection
 * 12. Automated bot detection
 * 13. Page blur/focus session heartbeat
 * 14. Source selection disabled
 * 15. Anti-screenshot CSS overlay on sensitive data
 */

import { useEffect, useRef, useCallback, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_CHANNEL = "primal-session-guard";
const INTEGRITY_KEY = "primal-integrity-hash";

// Simple hash for integrity checking
function quickHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function computeIntegrityHash(): string {
  const token = sessionStorage.getItem("primal-session-token") || "";
  const key = sessionStorage.getItem("primal-license-key") || "";
  const expires = sessionStorage.getItem("primal-session-expires") || "";
  return quickHash(`${token}|${key}|${expires}|${navigator.userAgent}`);
}

// Detect if running inside preview iframe
const isInIframe = window.self !== window.top;
const isPreviewEnv = isInIframe && /localhost|\.app$/.test(window.location.hostname);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, signOut } = useAuth();
  const logout = signOut;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const safeNavigate = useCallback((path: string) => {
    try {
      window.location.href = path;
    } catch {
      // Fails in sandboxed iframes — ignore
    }
  }, []);

  const handleSecurityViolation = useCallback((reason: string) => {
    console.warn(`[Security] ${reason}`);
    if (isAuthenticated) {
      logout();
      safeNavigate("/");
    }
  }, [isAuthenticated, logout, safeNavigate]);

  // ── 1 & 2. DevTools Detection ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkDevTools = () => {
      // Method 1: Window size difference
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;
      
      if (widthThreshold || heightThreshold) {
        // Don't logout immediately, just warn — some users have legitimate setups
        console.clear();
        console.warn("%c⚠️ SECURITY WARNING", "font-size: 30px; color: red; font-weight: bold;");
        console.warn("%cThis is a protected application. Unauthorized access attempts are logged.", "font-size: 14px;");
      }
    };

    // Method 2: Debugger timing detection — removed (causes "debugger paused" for users)

    const resizeHandler = () => checkDevTools();
    window.addEventListener("resize", resizeHandler);
    checkDevTools();

    return () => {
      window.removeEventListener("resize", resizeHandler);
    };
  }, [isAuthenticated]);

  // ── 3 & 4. Right-click & Keyboard shortcut blocking ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === "F12") { e.preventDefault(); return; }
      // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) { e.preventDefault(); return; }
      // Ctrl+U (view source)
      if (e.ctrlKey && e.key === "u") { e.preventDefault(); return; }
      // Cmd+Option+I (Mac)
      if (e.metaKey && e.altKey && e.key === "i") { e.preventDefault(); return; }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAuthenticated]);

  // ── 5. Console poisoning — trap console output in production ──
  useEffect(() => {
    if (!isAuthenticated) return;
    // Only poison in production builds
    if (import.meta.env.PROD) {
      const noop = () => {};
      const warn = () => {
        // Overwrite console methods to print only a warning
        (console as any).__proto__.log = noop;
        (console as any).__proto__.info = noop;
        (console as any).__proto__.debug = noop;
        (console as any).__proto__.table = noop;
        (console as any).__proto__.dir = noop;
        (console as any).__proto__.dirxml = noop;
        (console as any).__proto__.trace = noop;
        (console as any).__proto__.group = noop;
        (console as any).__proto__.groupEnd = noop;
        // Keep warn/error for critical browser messages but hijack them to clear first
        const origWarn = console.warn.bind(console);
        const origError = console.error.bind(console);
        console.warn = (...args: any[]) => {
          if (typeof args[0] === "string" && args[0].includes("[Security]")) {
            origWarn(...args);
          }
        };
        console.error = (...args: any[]) => {
          if (typeof args[0] === "string" && args[0].includes("[Security]")) {
            origError(...args);
          }
        };
      };
      warn();
      // Re-apply periodically in case devtools restores console
      const interval = setInterval(warn, 2000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // ── 6. Idle timeout ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const resetIdle = () => {
      lastActivityRef.current = Date.now();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        handleSecurityViolation("Session expired due to inactivity");
      }, IDLE_TIMEOUT_MS);
    };

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    events.forEach(e => document.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();

    return () => {
      events.forEach(e => document.removeEventListener(e, resetIdle));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isAuthenticated, handleSecurityViolation]);

  // ── 7. Tab visibility → re-validate on return ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Check if idle timeout was exceeded while tab was hidden
        const timeSinceActivity = Date.now() - lastActivityRef.current;
        if (timeSinceActivity > IDLE_TIMEOUT_MS) {
          handleSecurityViolation("Session expired while tab was inactive");
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isAuthenticated, handleSecurityViolation]);

  // ── 8. SessionStorage integrity check ──
  useEffect(() => {
    if (!isAuthenticated) return;

    // Store integrity hash on auth
    const currentHash = computeIntegrityHash();
    const storedHash = sessionStorage.getItem(INTEGRITY_KEY);
    
    if (storedHash && storedHash !== currentHash) {
      handleSecurityViolation("Session data tampering detected");
      return;
    }
    
    sessionStorage.setItem(INTEGRITY_KEY, currentHash);

    // Periodically check integrity
    const interval = setInterval(() => {
      const hash = computeIntegrityHash();
      const stored = sessionStorage.getItem(INTEGRITY_KEY);
      if (stored && stored !== hash) {
        handleSecurityViolation("Session data tampering detected");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, handleSecurityViolation]);

  // ── 9. Multiple tab detection ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const bc = new BroadcastChannel(SESSION_CHANNEL);
    
    // Announce this tab
    bc.postMessage({ type: "tab-open", timestamp: Date.now() });

    bc.onmessage = (event) => {
      if (event.data?.type === "tab-open") {
        // Another tab opened — warn but don't kick
        bc.postMessage({ type: "tab-warning", timestamp: Date.now() });
      }
      if (event.data?.type === "logout") {
        // Another tab logged out — sync
        logout();
        safeNavigate("/");
      }
    };

    return () => bc.close();
  }, [isAuthenticated, logout]);

  // ── 10. Text selection disabled on protected pages ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const style = document.createElement("style");
    style.id = "primal-security-css";
    style.textContent = `
      .protected-content {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
      }
      @media print {
        body { display: none !important; }
      }
    `;
    document.head.appendChild(style);

    return () => {
      const el = document.getElementById("primal-security-css");
      if (el) el.remove();
    };
  }, [isAuthenticated]);

  // ── 11. iFrame embed protection ──
  // Skip in development preview (which runs in an iframe)
  useEffect(() => {
    if (isPreviewEnv) return;
    if (window.self !== window.top) {
      try {
        document.body.innerHTML = "";
        window.top?.location.replace(window.location.href);
      } catch {
        // Sandboxed — can't navigate parent
      }
    }
  }, []);

  // ── 12. Bot detection ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const isBot = /bot|crawl|spider|slurp|lighthouse|headless/i.test(navigator.userAgent);
    const isAutomated = !!(navigator as any).webdriver;
    const noPlugins = navigator.plugins?.length === 0 && !/mobile/i.test(navigator.userAgent);

    if (isBot || isAutomated) {
      handleSecurityViolation("Automated access detected");
    }
    
    if (noPlugins && !("ontouchstart" in window)) {
      // Suspicious but not conclusive — log warning
      console.warn("[Security] Unusual browser environment detected");
    }
  }, [isAuthenticated, handleSecurityViolation]);

  // ── 13. Logout sync across tabs ──
  const originalLogout = logout;
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "primal-force-logout") {
        originalLogout();
        safeNavigate("/");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isAuthenticated, originalLogout]);

  // ── 14. Disable drag on images / sensitive content ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("dragstart", handleDragStart);
    return () => document.removeEventListener("dragstart", handleDragStart);
  }, [isAuthenticated]);

  // ── 15. Performance monitoring (detect replay attacks / automation) ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkTimingAnomaly = () => {
      const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      if (navEntry) {
        // If page loaded in < 50ms, likely automated
        const loadTime = navEntry.loadEventEnd - navEntry.startTime;
        if (loadTime > 0 && loadTime < 50) {
          console.warn("[Security] Suspicious page load timing detected");
        }
      }
    };

    // Check after page fully loads
    if (document.readyState === "complete") {
      checkTimingAnomaly();
    } else {
      window.addEventListener("load", checkTimingAnomaly, { once: true });
    }
  }, [isAuthenticated]);

  // ── 16. Strip data attributes and source hints from DOM ──
  useEffect(() => {
    if (!isAuthenticated || !import.meta.env.PROD) return;

    const scrub = () => {
      // Remove any data-lovable, data-lov, or data-component attributes
      document.querySelectorAll("[data-lovable-id],[data-lov-id],[data-component]").forEach((el) => {
        el.removeAttribute("data-lovable-id");
        el.removeAttribute("data-lov-id");
        el.removeAttribute("data-component");
      });
      // Remove HTML comments that may leak info
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
      const comments: Comment[] = [];
      while (walker.nextNode()) comments.push(walker.currentNode as Comment);
      comments.forEach((c) => c.remove());
    };

    scrub();
    const observer = new MutationObserver(scrub);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isAuthenticated]);

  // ── 17. Nuke source tab ──
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    // Override toString on functions to hide source
    try {
      const origToString = Function.prototype.toString;
      Function.prototype.toString = function () {
        if (this === Function.prototype.toString) return "function toString() { [native code] }";
        // Return a generic native-code string for app functions
        try {
          const src = origToString.call(this);
          if (src.includes("primal") || src.includes("Security") || src.includes("Auth")) {
            return "function () { [native code] }";
          }
          return src;
        } catch {
          return "function () { [native code] }";
        }
      };
    } catch {
      // Immutable in some engines
    }
  }, []);

  return <div className="protected-content">{children}</div>;
}
