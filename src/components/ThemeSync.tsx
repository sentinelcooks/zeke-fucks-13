import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Capacitor } from "@capacitor/core";

// Page background per theme; keep in sync with --background in index.css.
const THEME_COLOR = { light: "#F2F2F7", dark: "#000000" } as const;

/**
 * Keeps native chrome in step with the resolved Light/Dark theme:
 * the iOS/Android status bar text color and the browser theme-color.
 */
export function ThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const mode = resolvedTheme === "light" ? "light" : "dark";

    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute("content", THEME_COLOR[mode]));

    if (!Capacitor.isNativePlatform()) return;
    import("@capacitor/status-bar")
      .then(({ StatusBar, Style }) => {
        // Style.Dark = light text (for dark backgrounds); Style.Light = dark text.
        StatusBar.setStyle({ style: mode === "dark" ? Style.Dark : Style.Light }).catch(() => {});
      })
      .catch(() => {
        // Plugin not available — safe to ignore.
      });
  }, [resolvedTheme]);

  return null;
}
