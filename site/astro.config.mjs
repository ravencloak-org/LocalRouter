import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
export default defineConfig({
  site: "https://router.ravencloak.org",
  integrations: [sitemap()],
  devToolbar: { enabled: false },
});
