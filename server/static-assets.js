import express from "express";
import { extname, join } from "path";

const FRONTEND_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".mp3",
  ".png",
  ".svg",
  ".wasm",
  ".webmanifest",
  ".webp",
]);

function isBuiltAssetPath(pathname) {
  return pathname === "/assets" || pathname.startsWith("/assets/");
}

export function isFrontendAssetRequest(pathname) {
  if (!pathname) return false;
  if (isBuiltAssetPath(pathname)) return true;
  return FRONTEND_ASSET_EXTENSIONS.has(extname(pathname).toLowerCase());
}

export function setFrontendStaticHeaders(res, filePath) {
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (normalizedPath.endsWith("/index.html")) {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    return;
  }

  if (normalizedPath.includes("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=86400");
}

export function installProductionFrontend(app, distPath) {
  app.use(express.static(distPath, {
    index: false,
    setHeaders: setFrontendStaticHeaders,
  }));

  app.get("*", (req, res) => sendProductionFrontendFallback(req, res, distPath));
}

export function sendProductionFrontendFallback(req, res, distPath) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "Not found" });
  }

  if (isFrontendAssetRequest(req.path)) {
    return res
      .status(404)
      .type("text/plain")
      .set("Cache-Control", "no-store")
      .send("Frontend asset not found. Reload the app to fetch the latest build.");
  }

  res.set("Cache-Control", "no-cache, must-revalidate");
  return res.sendFile(join(distPath, "index.html"));
}
