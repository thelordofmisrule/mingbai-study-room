import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/generated-tts": "http://localhost:3001",
      "/generated-clips": "http://localhost:3001",
      "/imported-audio": "http://localhost:3001",
    },
  },
});
