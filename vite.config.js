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
// (e.g. "react" must not catch "@base-ui/react" or "react-router-dom").
const CODEMIRROR_PACKAGE_PATHS = [
  "/node_modules/@codemirror/",
  "/node_modules/@lezer/",
  "/node_modules/@marijn/find-cluster-break/",
  "/node_modules/crelt/",
  "/node_modules/style-mod/",
  "/node_modules/w3c-keyname/",
];

export function manualChunks(id) {
  const normalized = id.split(path.sep).join("/");
  if (!normalized.includes("/node_modules/")) return undefined;
  if (CODEMIRROR_PACKAGE_PATHS.some((packagePath) => normalized.includes(packagePath))) {
    return "codemirror-vendor";
  }
  if (normalized.includes("/node_modules/motion/")
    || normalized.includes("/node_modules/framer-motion/")) {
    return "motion";
  }
  if (normalized.includes("/node_modules/react/")
    || normalized.includes("/node_modules/react-dom/")
    || normalized.includes("/node_modules/react-router/")
    || normalized.includes("/node_modules/react-router-dom/")
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
    plugins: [tailwindcss(), react()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{
              name: manualChunks,
              // Rolldown measures this before minification. This keeps the
              // CodeMirror group below Vite's 500 kB emitted-chunk warning
              // without fragmenting the smaller React and Motion groups.
              maxSize: 1_300 * 1024,
            }],
          },
        },
      },
    },
    optimizeDeps: {
      include: [
        "@base-ui/react/button",
        "@base-ui/react/dialog",
        "@base-ui/react/input",
        "@base-ui/react/popover",
        "@base-ui/react/select",
        "@base-ui/react/switch",
        "@base-ui/react/tooltip",
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
