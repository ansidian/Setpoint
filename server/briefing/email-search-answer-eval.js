const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

function normalizeCases(fixture = {}) {
  const cases = Array.isArray(fixture) ? fixture : fixture.cases || [];
  return cases.map((testCase) => ({
    id: testCase.id || testCase.query,
    query: String(testCase.query || "").trim(),
    required_source_uids: [...(testCase.required_source_uids || testCase.requiredSourceUids || [])],
  })).filter((testCase) => testCase.id && testCase.query);
}

export async function evaluateAnswerCases(fixture, {
  answer,
  userId = "eval-user",
} = {}) {
  const results = [];
  for (const testCase of normalizeCases(fixture)) {
    const response = await answer(userId, { q: testCase.query });
    const problems = [];
    const answerPayload = response.answer || {};
    const cited = Array.isArray(answerPayload.cited_source_uids)
      ? answerPayload.cited_source_uids
      : [];
    const availableSources = new Set((response.sources || []).map((source) => source.uid));

    if (response.answer_status !== "ok") problems.push("answer_not_ok");
    if (!answerPayload.answer || typeof answerPayload.answer !== "string") problems.push("missing_answer");
    if (!VALID_CONFIDENCE.has(answerPayload.confidence)) problems.push("invalid_confidence");
    if (cited.some((uid) => !availableSources.has(uid))) problems.push("cited_source_not_returned");
    if (testCase.required_source_uids.some((uid) => !cited.includes(uid))) {
      problems.push("required_source_not_cited");
    }

    results.push({
      id: testCase.id,
      query: testCase.query,
      passed: problems.length === 0,
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
