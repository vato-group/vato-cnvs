import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @types/node isn't installed and tsconfig only loads "vite/client", so `process`
// (read at config-eval time in Node) is untyped. Declare just what we use here.
declare const process: { env: Record<string, string | undefined> };

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false, // don't hide Rust/cargo output during `tauri dev`
  // Excalidraw quirks: it checks process.env.IS_PREACT and needs es2022.
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  optimizeDeps: {
    include: ["@excalidraw/excalidraw"],
    esbuildOptions: { target: "es2022" },
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT) || 1420,
    strictPort: true, // must match tauri.conf.json devUrl
    host: "localhost",
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
