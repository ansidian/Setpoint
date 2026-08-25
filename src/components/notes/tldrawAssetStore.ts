import type { TLAssetStore } from "tldraw";
import { uploadTldrawAsset } from "../../api";

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSetpointTldrawAssetStore(): TLAssetStore {
  const uploadedThisSession = new Set<string>();
  return {
    async upload(_asset, file, signal) {
      const hash = await sha256(file);
      const src = `/api/tldraw/assets/${hash}`;
      if (!uploadedThisSession.has(hash)) {
        await uploadTldrawAsset(hash, file, signal);
        uploadedThisSession.add(hash);
      }
      return { src };
    },
    resolve(asset) {
      return asset.props.src;
    },
  };
}
