import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite serves the UI and proxies /api to FastAPI on :8000.
// `host: true` makes the dev server reachable from other devices on the LAN.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
});
