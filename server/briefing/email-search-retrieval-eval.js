export function normalizeRetrievalEvalFixture(fixture = {}) {
  const cases = Array.isArray(fixture) ? fixture : fixture.cases || [];
  return {
    version: fixture.version || 1,
    cases: cases.map((testCase) => ({
      id: testCase.id || testCase.query,
      query: String(testCase.query || "").trim(),
      expected_uids: [...(testCase.expected_uids || testCase.expectedUids || [])],
      must_not_top: [...(testCase.must_not_top || testCase.mustNotTop || [])],
      top_n: Number.parseInt(testCase.top_n || testCase.topN || 3, 10) || 3,
    })).filter((testCase) => testCase.id && testCase.query),
  };
}

export async function evaluateRetrievalCases(fixture, {
  retrieve,
  userId = "eval-user",
} = {}) {
  const normalized = normalizeRetrievalEvalFixture(fixture);
  const results = [];

  for (const testCase of normalized.cases) {
    const retrieval = await retrieve(userId, {
      q: testCase.query,
      limit: Math.max(testCase.top_n, 10),
    });
    const rankedUids = (retrieval.candidates || []).map((candidate) => candidate.uid);
    const topNUids = rankedUids.slice(0, testCase.top_n);
    const expectedHit = testCase.expected_uids.length === 0
      || testCase.expected_uids.some((uid) => topNUids.includes(uid));
    const mustNotTopClear = !testCase.must_not_top.includes(rankedUids[0]);
    const problems = [];
    if (!expectedHit) problems.push("expected_uid_not_in_top_n");
    if (!mustNotTopClear) problems.push("must_not_top_ranked_too_high");
    results.push({
      id: testCase.id,
      query: testCase.query,
      passed: expectedHit && mustNotTopClear,
      expected_hit: expectedHit,
      must_not_top_clear: mustNotTopClear,
      top_uids: topNUids,
      problems,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
