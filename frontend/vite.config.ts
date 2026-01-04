import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(() => {
  // Use BASE_PATH env var, default to "/"
  // Ensure trailing slash for proper URL construction
  let basePath = process.env.BASE_PATH || "/";
  if (basePath !== "/" && !basePath.endsWith("/")) {
    basePath = basePath + "/";
  }

  return {
    plugins: [react()],
    base: basePath,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    define: {
      __BASE_PATH__: JSON.stringify(basePath),
    },
    build: {
      outDir: process.env.BASE_PATH ? "dist-nomen" : "dist",
    },
  };
});
