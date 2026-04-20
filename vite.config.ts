import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name: "Primal Analytics",
        short_name: "Primal",
        description: "AI-powered sports analytics and prop predictions",
        theme_color: "#0a0a0b",
        background_color: "#0a0a0b",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/dashboard/picks",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  build: {
    sourcemap: false,
    minify: true,
    target: "es2020",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-router")) return "react-vendor";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("scheduler")) {
            return "react-vendor";
          }
          if (id.includes("@radix-ui")) return "radix-vendor";
          if (id.includes("recharts") || id.includes("chart.js") || id.includes("react-chartjs-2")) {
            return "charts-vendor";
          }
          if (id.includes("framer-motion")) return "motion-vendor";
          if (id.includes("@supabase") || id.includes("@lovable.dev/cloud-auth-js")) {
            return "supabase-vendor";
          }
          if (id.includes("@tanstack/react-query")) return "query-vendor";
          if (
            id.includes("date-fns") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge") ||
            id.includes("class-variance-authority") ||
            id.includes("zod")
          ) {
            return "utils-vendor";
          }
          if (id.includes("html-to-image")) return "image-vendor";
          return undefined;
        },
      },
    },
  },
}));
