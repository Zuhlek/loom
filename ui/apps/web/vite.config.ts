import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_PORT = parseInt(process.env.LOOM_PORT ?? "3737", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/ws": {
        target: `ws://127.0.0.1:${SERVER_PORT}`,
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
