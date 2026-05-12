import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const demoBase = env.VITE_EA_DEMO_BASE || env.VITE_EA_BASE_PATH;

  return {
    base: demoBase || "/",
    plugins: [tailwindcss(), react()],
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
    },
  };
})
