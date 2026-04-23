import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sentinel.picks',
  appName: 'Sentinel',
  webDir: 'dist',
  // No server.url — loads the bundled dist/ files from device storage.
  // For local dev with live-reload: run `npx cap run ios --livereload --external`
  // which injects the local server URL automatically.
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
