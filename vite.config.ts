import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Conservative vendor splitting: route a few heavy, stable libraries into their
// own chunks for better deploy cache granularity. Everything else (including the
// app entry) returns undefined and falls back to Rolldown's default chunking.
// Matching is on node_modules path segments to avoid substring false positives
// (e.g. "react" must not catch "@base-ui/react").
export function manualChunks(id: string): string | undefined {
  const normalized = id.split(path.sep).join("/");
  if (!normalized.includes("/node_modules/")) return undefined;
  if (normalized.includes("/node_modules/motion/")
    || normalized.includes("/node_modules/framer-motion/")) {
    return "motion";
  }
  if (normalized.includes("/node_modules/react/")
    || normalized.includes("/node_modules/react-dom/")
    || normalized.includes("/node_modules/react-router/")
    || normalized.includes("/node_modules/scheduler/")) {
    return "react-vendor";
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const demoBase = env.VITE_EA_DEMO_BASE || env.VITE_EA_BASE_PATH;

  return {
    base: demoBase || "/",
    plugins: [
      tailwindcss(),
      react(),
      env.VITE_EA_DEMO === "1" && {
        name: "setpoint-demo-social-preview",
        apply: "build",
        transformIndexHtml(html) {
          const title = "Setpoint — Stop piecing your day together.";
          const description = "A private workspace connecting Gmail, Google Calendar, Todoist, and Actual Budget—with AI email triage, summaries, semantic search, and time-to-leave reminders. Explore the demo with fictional data.";
          const url = "https://ansidian.github.io/Setpoint/";
          const image = `${url}setpoint-social-preview.png`;
          const imageAlt = "Setpoint: Stop piecing your day together. A fictional dashboard alongside AI email triage, semantic search, an AI assistant, and Gmail, Google Calendar, Todoist, and Actual Budget integrations.";

          // Emit static metadata for link crawlers only in the public demo build.
          return {
            html: html.replace("<title>Setpoint</title>", `<title>${title}</title>`),
            tags: [
              { tag: "link", attrs: { rel: "canonical", href: url } },
              ...Object.entries({
                description,
                "twitter:card": "summary_large_image",
                "twitter:title": title,
                "twitter:description": description,
                "twitter:image": image,
                "twitter:image:alt": imageAlt,
              }).map(([name, content]) => ({ tag: "meta", attrs: { name, content } })),
              ...Object.entries({
                "og:type": "website",
                "og:site_name": "Setpoint",
                "og:title": title,
                "og:description": description,
                "og:url": url,
                "og:image": image,
                "og:image:type": "image/png",
                "og:image:width": "1200",
                "og:image:height": "630",
                "og:image:alt": imageAlt,
              }).map(([property, content]) => ({ tag: "meta", attrs: { property, content } })),
            ].map((tag) => ({ ...tag, injectTo: "head" as const })),
          };
        },
      },
    ],
    build: {
      // Notes is lazy-loaded and intentionally carries tldraw as one large
      // feature chunk. Keep a warning guard without forcing tldraw's circular
      // module graph into manually fragmented vendor chunks.
      chunkSizeWarningLimit: 2_000,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{
              name: manualChunks,
              // Rolldown measures this before minification. This bounds the
              // explicitly named React and Motion vendor groups.
              maxSize: 1_300 * 1024,
            }],
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ["@tldraw/assets"],
      include: [
        "@base-ui/react/button",
        "@base-ui/react/dialog",
        "@base-ui/react/input",
        "@base-ui/react/popover",
        "@base-ui/react/select",
        "@base-ui/react/switch",
        "@base-ui/react/tooltip",
        "lodash.isequalwith",
        "lodash.isequal",
        "lodash.throttle",
        "lodash.uniq",
      ],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      proxy: {
        "/api": "http://localhost:3001",
      },
      watch: {
        // .grepai index churn (stats.json appends, .gob rewrites) must never
        // reach the watcher: Tailwind v4 scans non-gitignored files and each
        // write triggered a full page reload in dev.
        ignored: ["**/.grepai/**", "**/server/db/**"],
      },
    },
  };
})
