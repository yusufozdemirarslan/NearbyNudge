import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// NearbyNudge 2.0 frontend.
// - `npm run dev`       → talks to the real backend through the /api proxy.
// - `npm run dev:mock`  → mode "mock" (.env.mock sets VITE_MOCK_API=1) uses the
//                          in-memory mock adapter in src/lib/api/mock.
// The mock flag is replaced at build time with a literal "1" or "0", so the
// mock adapter is removed from production bundles by dead-code elimination.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "")
  const mock = env.VITE_MOCK_API === "1"
  const backend = env.NN_BACKEND_URL || "http://127.0.0.1:8000"

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_MOCK_API": JSON.stringify(mock ? "1" : "0"),
    },
    // Pre-bundle what lazy routes import, so the dev server never re-optimizes
    // (and reloads the page) the first time someone opens Numbers or Settings.
    optimizeDeps: {
      include: [
        "recharts",
        "@tanstack/react-table",
        "react-hook-form",
        "@hookform/resolvers/zod",
        "zod",
        "cmdk",
      ],
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: mock
        ? undefined
        : {
            // JSON API and the Server-Sent Events stream. http-proxy streams
            // responses as they arrive, so text/event-stream works as is.
            "/api": {
              target: backend,
              changeOrigin: false,
              configure(proxy) {
                proxy.on("proxyRes", (proxyRes) => {
                  const type = proxyRes.headers["content-type"] ?? ""
                  if (String(type).includes("text/event-stream")) {
                    // Make sure nothing between us and the browser buffers it.
                    proxyRes.headers["cache-control"] = "no-cache, no-transform"
                    proxyRes.headers["x-accel-buffering"] = "no"
                  }
                })
              },
            },
          },
    },
    preview: {
      port: 4173,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      // One CSS file and hashed chunks; the backend serves dist/ as is.
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 900,
    },
  }
})
