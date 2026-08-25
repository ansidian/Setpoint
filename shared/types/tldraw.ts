export type TldrawDocumentJson = {
  store: Record<string, unknown>;
  schema: Record<string, unknown>;
};

export type TldrawDocumentEnvelope = {
  document: TldrawDocumentJson | null;
  revision: number;
  updatedAt: string | null;
};

export type SaveTldrawDocumentRequest = {
  document: TldrawDocumentJson;
  baseRevision: number;
};

export type SaveTldrawDocumentResponse = {
  revision: number;
  updatedAt: string;
  unchanged: boolean;
};

export type TldrawBootstrapResponse = {
  licenseKey: string | null;
  licenseRequired: boolean;
  document: TldrawDocumentEnvelope;
};

export type TldrawAssetUploadResponse = {
  src: string;
  hash: string;
  deduplicated: boolean;
};
