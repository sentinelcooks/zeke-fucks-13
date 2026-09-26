import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";

// Initialize native status bar to overlay the webview so safe-area insets
// are reported correctly on iOS and Android. Its text color follows the
// Light/Dark theme and is set by <ThemeSync />.
if (Capacitor.isNativePlatform()) {
  import("@capacitor/status-bar")
    .then(({ StatusBar }) => {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    })
    .catch(() => {
      // Plugin not available — safe to ignore on web.
    });
}

createRoot(document.getElementById("root")!).render(<App />);
