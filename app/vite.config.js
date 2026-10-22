import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // the app imports the shared scoring engine and demo data from the repo root
  server: { fs: { allow: [".."] } },
});
