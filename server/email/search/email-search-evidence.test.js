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
