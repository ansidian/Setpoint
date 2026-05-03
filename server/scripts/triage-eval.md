# Triage Eval Runner

PER-47 adds a local, privacy-conscious eval path for durable email triage. The prod seed artifact under `docs/triage-redesign/prod-triage-seed-candidates.json` contains weak legacy labels only. Do not treat those labels as truth until a row has been manually reviewed.

Create a local labeled fixture at `docs/triage-redesign/labeled-triage-eval.json`. `docs/` is gitignored, so private email samples stay local.

Fixture shape:

```json
{
  "eval_seed": [
    {
      "sample_id": "manual-001",
      "sender_display": "School Billing",
      "from_address": "billing@example.edu",
      "subject": "Payment due for tuition",
      "summary": "Tuition balance is due May 8.",
      "expected_lane": "needs_attention",
      "expected_category": "finance",
      "expected_urgency": "high",
      "expected_escalation_badge": "High Risk",
      "expected_deadline_at": "2026-05-08T16:00:00.000Z",
      "labels_verified": true,
      "mock_model_outputs": {
        "strong": {
          "lane": "needs_attention",
          "category": "finance",
          "urgency": "high",
          "escalation_badge": "High Risk",
          "summary": "Tuition payment is due.",
          "action": "Review payment",
          "deadline_at": "2026-05-08T16:00:00.000Z",
          "confidence": 0.9,
          "bill_candidate": null
        }
      }
    }
  ]
}
```

Run deterministic mocked evals:

```sh
npm run triage:eval
```

Use another fixture:

```sh
npm run triage:eval -- --fixture docs/triage-redesign/my-labeled-eval.json
```

Real model calls are opt-in and should not be used from default tests:

```sh
EA_TRIAGE_EVAL_REAL_MODELS=1 npm run triage:eval -- --real-models
```

The text output lists dangerous misses first, then aggregate stats and lower-risk mismatches.
