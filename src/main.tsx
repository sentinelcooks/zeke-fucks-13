import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";

// Initialize native status bar to overlay the webview so safe-area insets
// are reported correctly on iOS and Android.
if (Capacitor.isNativePlatform()) {
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    })
    .catch(() => {
      // Plugin not available — safe to ignore on web.
    });
}

createRoot(document.getElementById("root")!).render(<App />);
