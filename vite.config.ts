import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
    port: 1420,
    strictPort: true, // must match tauri.conf.json devUrl
    host: "localhost",
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
