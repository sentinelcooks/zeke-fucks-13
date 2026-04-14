import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sentinel.analytics',
  appName: 'Primal Analytics',
  webDir: 'dist',
  server: {
    url: 'https://violet-key-login.lovable.app',
    cleartext: true,
  },
};

export default config;
