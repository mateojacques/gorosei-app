import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    // Same-origin websocket so the session cookie authenticates the upgrade.
    proxy: { "/realtime": { target: `ws://localhost:${process.env.REALTIME_PORT ?? 3001}`, ws: true, rewrite: () => "/" } },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
