import {
  EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
  EMAIL_SEARCH_EMBEDDING_MODEL,
} from "./email-search-embeddings.js";

function buildEmbeddingError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function parseProviderError(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || response.statusText || `HTTP ${response.status}`;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

export function createEmailSearchEmbeddingClient({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    async embed(inputs) {
      const normalizedInputs = Array.isArray(inputs) ? inputs : [inputs];
      if (!apiKey) {
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
          Authorization: `Bearer ${apiKey}`,
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
        const detail = await parseProviderError(response);
        throw buildEmbeddingError(
          `OpenAI embeddings request failed: ${detail}`,
          502,
          "email_search_embeddings_provider_error",
        );
      }

      const body = await response.json();
      const vectors = [...(body?.data || [])]
        .sort((a, b) => Number(a.index) - Number(b.index))
        .map((item) => item.embedding);

      if (vectors.length !== normalizedInputs.length || vectors.some((vector) => !Array.isArray(vector))) {
        throw buildEmbeddingError(
          "OpenAI embeddings response did not include all requested embeddings",
          502,
          "email_search_embeddings_provider_error",
        );
      }

      Object.defineProperties(vectors, {
        model: {
          value: body?.model || EMAIL_SEARCH_EMBEDDING_MODEL,
          enumerable: false,
        },
        usage: {
          value: body?.usage || {},
          enumerable: false,
        },
      });

      return vectors;
    },
  };
}
