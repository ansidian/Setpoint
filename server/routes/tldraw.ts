import { Router, raw, type RequestHandler } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import {
  tldrawDocumentService,
  type TldrawDocumentService,
} from "../tldraw/tldraw-document-service.ts";
import {
  TLDRAW_ASSET_MAX_BYTES,
  tldrawAssetService,
  type TldrawAssetService,
} from "../tldraw/tldraw-asset-service.ts";
import { resolveTldrawLicenseKey } from "../tldraw/tldraw-license.ts";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import type {
  SaveTldrawDocumentRequest,
  TldrawAssetUploadResponse,
  TldrawBootstrapResponse,
} from "../../shared/types/tldraw.ts";

function ownerUserId(): string {
  return process.env.EA_USER_ID!;
}

function isRawBody(value: unknown): value is Buffer {
  return Buffer.isBuffer(value);
}

export function createTldrawRouter({
  documents = tldrawDocumentService,
  assets = tldrawAssetService,
  credentials,
  authenticate = requireCookieSession,
}: {
  documents?: TldrawDocumentService;
  assets?: TldrawAssetService;
  credentials?: Pick<InstanceCredentialService, "resolve">;
  authenticate?: RequestHandler;
} = {}) {
  const router = Router();
  wrapRouterAsync(router);
  router.use(authenticate);

  router.get<Record<string, never>, TldrawBootstrapResponse>("/bootstrap", async (_req, res) => {
    const licenseRequired = process.env.NODE_ENV === "production";
    const [licenseKey, document] = await Promise.all([
      licenseRequired ? resolveTldrawLicenseKey(credentials) : Promise.resolve(null),
      documents.getDocument(ownerUserId()),
    ]);
    return res.json({ licenseKey, licenseRequired, document });
  });

  router.put<Record<string, never>, unknown, SaveTldrawDocumentRequest>("/document", async (req, res) => {
    return res.json(await documents.saveDocument(
      ownerUserId(),
      req.body?.document,
      req.body?.baseRevision,
    ));
  });

  router.put<{ hash: string }, TldrawAssetUploadResponse | { message: string }>(
    "/assets/:hash",
    raw({ type: "*/*", limit: TLDRAW_ASSET_MAX_BYTES }),
    (req, res, next) => {
      if (!isRawBody(req.body)) return res.status(400).json({ message: "Media body is required" });
      next();
    },
    async (req, res) => {
      const bytes = req.body as Buffer;
      if (bytes.length > TLDRAW_ASSET_MAX_BYTES) {
        return res.status(413).json({ message: "Media exceeds the 10 MB limit" });
      }
      const hash = req.params.hash;
      const result = await assets.putAsset({
        hash,
        mimeType: req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
        bytes,
        originalName: req.get("x-tldraw-file-name"),
      });
      return res.json({
        src: `/api/tldraw/assets/${result.metadata.hash}`,
        hash: result.metadata.hash,
        deduplicated: result.deduplicated,
      });
    },
  );

  router.get<{ hash: string }>("/assets/:hash", async (req, res) => {
    const { metadata, bytes } = await assets.getAsset(req.params.hash);
    const etag = `"sha256-${metadata.hash}"`;
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.set({
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": metadata.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    });
    return res.send(bytes);
  });

  return router;
}

export default createTldrawRouter();
