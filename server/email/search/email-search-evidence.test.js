import { describe, expect, it } from "vitest";
import { filterEmailSearchCandidatesForEvidence } from "./email-search-evidence.js";

describe("lexical evidence floor", () => {
  const strongLexical = {
    uid: "lex-1",
    subject: "Quarterly statement ready",
    from: { name: "Chase", address: "no-reply@chase.com" },
    provenance: { lexical: true, vector: false },
    scores: { lexical: 0.45, vector: 0.1, combined: 0.25 },
  };

  it("keeps a strong lexical candidate whose vector similarity is below the semantic floor", () => {
    const kept = filterEmailSearchCandidatesForEvidence([strongLexical], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept).toHaveLength(1);
  });

  it("still drops weak candidates with no field evidence", () => {
    const weak = {
      ...strongLexical,
      uid: "lex-2",
      scores: { lexical: 0.1, vector: 0.1, combined: 0.1 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([weak], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });

  it("does not let a zero-result fallback pass satisfy the lexical floor (loosened matches are speculative)", () => {
    const fallbackRow = {
      uid: "lex-fallback",
      subject: "Quarterly newsletter",
      from: { name: "Marketing", address: "news@vendor.com" },
      provenance: { lexical: true, vector: false, lexical_fallback: true },
      scores: { lexical: 0.45, vector: 0.1, combined: 0.25 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([fallbackRow], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });

  it("does not treat vector-only provenance as lexical evidence", () => {
    const vectorOnly = {
      ...strongLexical,
      uid: "lex-3",
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.45, vector: 0.1, combined: 0.2 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([vectorOnly], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });
});

describe("vector semantic floor", () => {
  it("keeps a candidate whose vector similarity meets the floor with no lexical provenance", () => {
    const vectorAtFloor = {
      uid: "vec-1",
      subject: "Trip itinerary",
      from: { name: "Airline", address: "no-reply@airline.com" },
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.32, combined: 0.18 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([vectorAtFloor], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["vec-1"]);
  });

  it("drops a candidate whose vector similarity sits just below the floor with no other evidence", () => {
    const vectorBelowFloor = {
      uid: "vec-2",
      subject: "Trip itinerary",
      from: { name: "Airline", address: "no-reply@airline.com" },
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.31, combined: 0.18 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([vectorBelowFloor], {
      q: "credit card payment due",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });
});

describe("planned-phrase evidence", () => {
  it("keeps a low-score candidate when a plan.lexical_queries phrase appears in the subject", () => {
    const lowScore = {
      uid: "phrase-1",
      subject: "Your quarterly statement is ready",
      from: { name: "Chase", address: "no-reply@chase.com" },
      provenance: { lexical: false, vector: false },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([lowScore], {
      q: "credit card payment due",
      plan: { lexical_queries: ["quarterly statement"] },
    });
    expect(kept.map((c) => c.uid)).toEqual(["phrase-1"]);
  });

  it("drops a low-score candidate when no planned phrase matches its fields", () => {
    const lowScore = {
      uid: "phrase-2",
      subject: "Your quarterly statement is ready",
      from: { name: "Chase", address: "no-reply@chase.com" },
      provenance: { lexical: false, vector: false },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([lowScore], {
      q: "credit card payment due",
      plan: { lexical_queries: ["mortgage refinance"] },
    });
    expect(kept).toHaveLength(0);
  });
});

describe("subject/sender token evidence", () => {
  const lowScoreCandidate = {
    uid: "field-1",
    subject: "Quarterly statement ready",
    from: { name: "Chase", address: "no-reply@chase.com" },
    provenance: { lexical: false, vector: false },
    scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
  };

  it("keeps a low-score candidate when two query tokens hit the subject/sender", () => {
    const kept = filterEmailSearchCandidatesForEvidence([lowScoreCandidate], {
      q: "quarterly statement",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["field-1"]);
  });

  it("drops a low-score candidate when only a single query token hits the subject/sender", () => {
    const kept = filterEmailSearchCandidatesForEvidence([lowScoreCandidate], {
      q: "quarterly mortgage",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });
});

describe("sender-address sub-tokens (C5)", () => {
  it("matches a query brand against the sender domain even when the display name never names it", () => {
    const candidate = {
      uid: "domain-1",
      subject: "Quarterly statement ready",
      from: { name: "Card Services", address: "no-reply@chase.com" },
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([candidate], {
      q: "chase statement",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["domain-1"]);
  });
});

describe("prefix matching against field tokens (C5 anchor)", () => {
  it("lets a query brand prefix-match a compound domain label, mirroring FTS prefix semantics", () => {
    // The anchor sender: 'synchrony' can never EQUAL the domain label
    // 'synchronybank', yet FTS's "synchrony"* matched it — the gate must not be
    // stricter than the retrieval it filters.
    const candidate = {
      uid: "prefix-1",
      subject: "Your PayPal Cashback World Mastercard statement is ready",
      from: { name: "PayPal", address: "ppv@mail.synchronybank.com" },
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([candidate], {
      q: "synchrony statement",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["prefix-1"]);
  });

  it("does not let very short terms prefix-match their way into evidence", () => {
    const candidate = {
      uid: "prefix-2",
      subject: "Concert tickets inside",
      from: { name: "Events", address: "hello@stubhub.com" },
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    // 'stu' (3 chars) must not count as matching 'stubhub'; 'con' likewise for 'concert'.
    const kept = filterEmailSearchCandidatesForEvidence([candidate], {
      q: "stu con",
      plan: null,
    });
    expect(kept).toHaveLength(0);
  });
});

describe("body-snippet evidence (C5)", () => {
  it("counts query terms found in the visible body snippet, not just subject/sender", () => {
    const candidate = {
      uid: "snippet-1",
      subject: "Payment reminder",
      from: { name: "Billing", address: "billing@vendor.example" },
      body_snippet: "Your statement balance is due on 07/07.",
      provenance: { lexical: false, vector: true },
      scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
    };
    const kept = filterEmailSearchCandidatesForEvidence([candidate], {
      q: "payment statement",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["snippet-1"]);
  });
});

describe("near-floor vector with corroborating field evidence (C5)", () => {
  const nearFloorCandidate = (uid, vector, subject) => ({
    uid,
    subject,
    from: { name: "Notifications", address: "no-reply@vendor.example" },
    provenance: { lexical: false, vector: true },
    scores: { lexical: 0.05, vector, combined: 0.2 },
  });

  it("keeps a candidate just under the hard vector floor when a field token corroborates it", () => {
    // Prod anchor: the newest statement scored vector 0.31 (< 0.32) and was dropped
    // while a wrong-family sibling at 0.35 was kept.
    const kept = filterEmailSearchCandidatesForEvidence(
      [nearFloorCandidate("near-1", 0.29, "Your statement is ready")],
      { q: "synchrony statement due date", plan: null },
    );
    expect(kept.map((c) => c.uid)).toEqual(["near-1"]);
  });

  it("still drops a near-floor candidate with zero field evidence", () => {
    const kept = filterEmailSearchCandidatesForEvidence(
      [nearFloorCandidate("near-2", 0.29, "Weekend getaway deals")],
      { q: "synchrony statement due date", plan: null },
    );
    expect(kept).toHaveLength(0);
  });

  it("still drops a corroborated candidate whose vector sits below the near-floor band", () => {
    const kept = filterEmailSearchCandidatesForEvidence(
      [nearFloorCandidate("near-3", 0.27, "Your statement is ready")],
      { q: "synchrony statement due date", plan: null },
    );
    expect(kept).toHaveLength(0);
  });
});

describe("empty / stopword-only query", () => {
  const droppableCandidate = {
    uid: "skip-1",
    subject: "Quarterly statement ready",
    from: { name: "Chase", address: "no-reply@chase.com" },
    provenance: { lexical: false, vector: false },
    scores: { lexical: 0.05, vector: 0.05, combined: 0.05 },
  };

  it("returns the full list unfiltered when the query is empty and there is no plan", () => {
    const kept = filterEmailSearchCandidatesForEvidence([droppableCandidate], {
      q: "",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["skip-1"]);
  });

  it("returns the full list unfiltered when the query is only stopwords", () => {
    const kept = filterEmailSearchCandidatesForEvidence([droppableCandidate], {
      q: "the my to",
      plan: null,
    });
    expect(kept.map((c) => c.uid)).toEqual(["skip-1"]);
  });
});
