import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_MODEL,
} from "./email-search-embeddings.ts";
import { resolveAiApiKey } from "../../ai-credentials.ts";

export interface EmailSearchEmbeddingError extends Error {
  status: number;
  code: string;
}

export type EmailSearchEmbeddingVectors = number[][] & {
  model?: string;
  usage?: Record<string, unknown>;
};

export interface EmailSearchEmbeddingClient {
  embed(inputs: string[]): Promise<EmailSearchEmbeddingVectors>;
}

interface EmbeddingClientOptions {
  apiKey?: string;
  credentialResolver?: () => Promise<string | null>;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<EmbeddingFetchResponse>;
}

interface EmbeddingFetchResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildEmbeddingError(message: string, status: number, code: string): EmailSearchEmbeddingError {
  const err = new Error(message) as EmailSearchEmbeddingError;
  err.status = status;
  err.code = code;
  return err;
}

export function createEmailSearchEmbeddingClient({
  apiKey,
  credentialResolver = () => resolveAiApiKey("openai"),
  fetchImpl = globalThis.fetch,
}: EmbeddingClientOptions = {}): EmailSearchEmbeddingClient {
  return {
    async embed(inputs: string[]): Promise<EmailSearchEmbeddingVectors> {
      const normalizedInputs = inputs;
      const currentApiKey = apiKey === undefined ? await credentialResolver() : apiKey;
      if (!currentApiKey) {
        throw buildEmbeddingError(
          "OPENAI_API_KEY not set for email search embeddings",
          503,
          "email_search_embeddings_unavailable",
        );
      }
      if (!fetchImpl) {
        throw buildEmbeddingError(
          "fetch is unavailable for email search embeddings",
          503,
          "email_search_embeddings_unavailable",
        );
      }

      const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMAIL_SEARCH_EMBEDDING_MODEL,
          input: normalizedInputs,
          dimensions: EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
          encoding_format: "float",
        }),
      });

      if (!response.ok) {
        await response.json().catch(() => null);
        throw buildEmbeddingError(
          "OpenAI embeddings request failed",
          502,
          "email_search_embeddings_provider_error",
        );
      }

      const body: unknown = await response.json();
      const data = isRecord(body) && Array.isArray(body.data) ? body.data.filter(isRecord) : [];
      const vectors = data
        .sort((a, b) => Number(a.index) - Number(b.index))
        .map((item) => item.embedding) as EmailSearchEmbeddingVectors;

      if (vectors.length !== normalizedInputs.length || vectors.some((vector) => !Array.isArray(vector))) {
        throw buildEmbeddingError(
          "OpenAI embeddings response did not include all requested embeddings",
          502,
          "email_search_embeddings_provider_error",
        );
      }

      Object.defineProperties(vectors, {
        model: {
          value: isRecord(body) && typeof body.model === "string" ? body.model : EMAIL_SEARCH_EMBEDDING_MODEL,
          enumerable: false,
        },
        usage: {
          value: isRecord(body) && isRecord(body.usage) ? body.usage : {},
          enumerable: false,
        },
      });

      return vectors;
    },
  };
}
