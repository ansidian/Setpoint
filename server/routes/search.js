import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.js";
import { embedText, searchSimilar, isEmbeddingAvailable } from "../embeddings/index.js";
import { seedEmbeddings, getDevQueryVector } from "../db/dev-seed-embeddings.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const router = Router();
router.use(requireCookieSession);

// --- Tier 1: Vector search ---

router.get("/", async (req, res) => {
  try {
    const { q, types, limit } = req.query;
    if (!q) return res.status(400).json({ message: "Query parameter 'q' is required" });

    const topK = Math.min(parseInt(limit) || 10, 25);
    const sectionTypes = types ? types.split(",") : undefined;
    const userId = process.env.EA_USER_ID;

    let queryEmbedding;
    if (process.env.DEV_MOCK_SEARCH === "1" || !isEmbeddingAvailable()) {
      // Dev mode: use pre-computed fake vectors for testing
      queryEmbedding = getDevQueryVector(q);
    } else {
      queryEmbedding = await embedText(q);
    }

    const results = await searchSimilar({ userId, queryEmbedding, topK, sectionTypes });
    res.json({ results, query: q });
  } catch (err) {
    console.error("[EA] Search error:", err.message);
    const status = err.message.includes("429") ? 429 : 500;
    const message = status === 429 ? "Embedding API quota exceeded — check OpenAI billing" : err.message;
    res.status(status).json({ message });
  }
});

// --- Tier 2: Claude-enhanced analysis ---

router.post("/analyze", async (req, res) => {
  try {
    const { query, results } = req.body;
    if (!query || !results?.length) {
      return res.status(400).json({ message: "Query and results are required" });
    }

    // Dev mock mode: return canned response
    if (process.env.DEV_MOCK_SEARCH === "1") {
      return res.json({
        analysis: `Based on your search for "${query}", here's what I found across ${results.length} briefing entries:\n\n` +
          "Your electricity bills have been steadily increasing: $88 → $95 → $118 → $142 over the past 3 months, " +
          "representing a 61% increase. This trend suggests checking for unusual usage patterns or rate changes.\n\n" +
          "Dr. Smith has been a recurring sender over the past 2 weeks with research-related emails requiring responses.",
      });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "Claude API not configured for search analysis" });
    }

    const context = results.map(r =>
      `[${r.source_date} · ${r.section_type}] ${r.chunk_text}`
    ).join("\n\n");

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `You are a personal assistant analyzing historical briefing data. The user searched for: "${query}"\n\nHere are the relevant results from past briefings:\n\n${context}\n\nProvide a concise analysis: summarize trends, patterns, and actionable observations. Keep it under 200 words.`,
        }],
      }),
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      throw new Error(`Claude API error (${apiRes.status}): ${text}`);
    }

    const data = await apiRes.json();
    const analysis = data.content?.[0]?.text || "No analysis available.";
    res.json({ analysis });
  } catch (err) {
    console.error("[EA] Search analyze error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// --- Dev-only: seed embeddings ---

if (process.env.NODE_ENV !== "production") {
  router.get("/seed", async (req, res) => {
    try {
      const seeded = await seedEmbeddings();
      res.json({ seeded, message: seeded ? "Dev embeddings seeded" : "Already seeded" });
    } catch (err) {
      console.error("[EA] Seed error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });
}

export default router;
