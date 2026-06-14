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
