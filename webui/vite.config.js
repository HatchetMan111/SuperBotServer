import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// botd serviert die Web-UI über eine harte Whitelist: genau 3 Dateien
// ("/", "/index.html", "/app.js", "/styles.css") – siehe server/src/main.rs.
// Deshalb muss der Build exakt diese 3 Dateien in dist/ erzeugen.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    assetsDir: "",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: (info) => (info.names?.[0] ?? info.name ?? "").endsWith(".css") ? "styles.css" : "[name][extname]",
      },
    },
  },
});
