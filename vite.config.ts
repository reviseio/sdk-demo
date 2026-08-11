import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/, so the deploy workflow
  // sets BASE_PATH to match. Local dev and root-domain hosting use "/".
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 4321,
    // The demo backend (`npm run server`) — a Node service built on
    // @reviseio/sdk/backend. The Backend panel degrades gracefully when it
    // is not running (e.g. on the static GitHub Pages deployment).
    proxy: { "/api": "http://localhost:8787" },
  },
  resolve: {
    // Yjs identifies its own types with `instanceof`, so the SDK and this app
    // must share ONE copy. Without this, the Y.Doc built here rejects the
    // nodes the editor inserts into it.
    dedupe: ["yjs", "y-protocols", "react", "react-dom"],
  },
  optimizeDeps: {
    // All three on the SAME side of the dep optimizer. Excluding the SDK but
    // optimizing Yjs is the trap: the SDK's `import "yjs"` then resolves to
    // node_modules/yjs while this app's resolves to the optimized copy under
    // .vite/deps — two module URLs, two Yjs instances, and every node the
    // editor inserts into a host-built Y.Doc is rejected.
    exclude: ["@reviseio/sdk", "yjs", "y-protocols"],
  },
});
