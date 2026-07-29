import { defineConfig } from "vite";
import ripple from "vite-plugin-ripple";

// ponytail: verify the plugin's exact package name/export against ripple-ts.com — Ripple
// is alpha and this may be `@ripple/vite-plugin` or similar in your pinned version.
export default defineConfig({
  plugins: [ripple()],
  server: {
    port: 5173,
    fs: { allow: [".."] }, // let src import ../shared/events (type-only)
    proxy: {
      "/events": { target: "http://localhost:8083", changeOrigin: true },
      "/v1": "http://localhost:8083",
      "/healthz": "http://localhost:8083",
    },
  },
});
