import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import {
  defineConfig,
  type PluginOption,
} from "vite";

const reactPlugin =
  react() as unknown as PluginOption;

export default defineConfig({
  plugins: [reactPlugin],

  resolve: {
    alias: {
      "@": fileURLToPath(
        new URL("./src", import.meta.url),
      ),

      "@gano-bot/shared": fileURLToPath(
        new URL(
          "../../packages/shared/src",
          import.meta.url,
        ),
      ),

      "@gano-bot/chat-widget": fileURLToPath(
        new URL(
          "../../packages/chat-widget/src",
          import.meta.url,
        ),
      ),

      "@gano-bot/ai-core": fileURLToPath(
        new URL(
          "../../packages/ai-core/src",
          import.meta.url,
        ),
      ),

      "@gano-bot/business-engine-adapter":
        fileURLToPath(
          new URL(
            "../../packages/business-engine-adapter/src",
            import.meta.url,
          ),
        ),
    },
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    open: false,
  },

  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: false,
  },

  build: {
    outDir: "dist",
    assetsDir: "assets",

    target: "es2022",

    cssTarget: [
      "chrome111",
      "edge111",
      "firefox114",
      "safari16.4",
    ],

    sourcemap: true,
    emptyOutDir: true,
    reportCompressedSize: true,
  },
});