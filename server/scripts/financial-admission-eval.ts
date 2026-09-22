import "dotenv/config";
import fixtures from "../triage/fixtures/financial-admission.json" with { type: "json" };
import { assessProviderFinancialEmail } from "../financial-parsers/index.ts";
import { createFinancialDocumentClassifier } from "../triage/financial-document-classifier.ts";
import { withAiUsageContext } from "../platform/ai-usage.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--real-models")) throw new Error("Use npm run financial-admission:eval [-- --real-models].");
  const real = args.includes("--real-models");
  const userId = process.env.EA_USER_ID;
  if (real && !userId) throw new Error("Real evaluation requires EA_USER_ID and configured model credentials/settings for that owner.");
  const classifier = real ? createFinancialDocumentClassifier() : null;
  const results = [];
  for (const fixture of fixtures) {
    const deterministic = assessProviderFinancialEmail(fixture.source).status;
    if (!classifier || !userId) {
      results.push({ name: fixture.name, expected: fixture.expected, deterministic });
      continue;
    }
    try {
      // Bypass provider recognition only in this AI arm; report the unchanged
      // source's deterministic disposition separately.
      const candidate = await withAiUsageContext({ userId, origin: "background_triage", runContext: "evaluation" }, () =>
        classifier.assessFinancialDocument(userId, {user_id:userId,account_id:"evaluation",email_id:fixture.name,
          from_address:"admission-eval@example.test",subject:fixture.source.subject,body_text:fixture.source.body}));
      const actual = candidate === null ? "nonfinancial"
        : candidate.event_verification?.status === "failed" ? "error"
        : candidate.event_verification?.assessment?.outcome === "uncertain" ? "uncertain" : "financial_event";
      results.push({ name:fixture.name,expected:fixture.expected,actual,deterministic,
        falsePositive:fixture.expected === "nonfinancial" && actual === "financial_event",
        missedEvent:fixture.expected === "financial_event" && actual === "nonfinancial" });
    } catch {
      // Provider errors can include request details. Never print source text or credentials.
      results.push({name:fixture.name,expected:fixture.expected,actual:"error",deterministic});
    }
  }
  console.log(JSON.stringify({mode:real?"real_models":"corpus_only",
    ...(real ? {aiSender:"admission-eval@example.test",deterministicSender:"original fixture sender"} : {}),cases:results.length,
    ...(real ? {falsePositives:results.filter(row=>"falsePositive" in row && row.falsePositive).length,
      missedEvents:results.filter(row=>"missedEvent" in row && row.missedEvent).length,
      uncertain:results.filter(row=>"actual" in row && row.actual === "uncertain").length,
      errors:results.filter(row=>"actual" in row && row.actual === "error").length} : {}),results},null,2));
  if(real && results.some(row=>"actual" in row && row.actual !== row.expected)) process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error ? error.message : "Financial admission evaluation failed.");process.exitCode=1;});
