// Simulates bill cross-reference with Actual Budget scheduled payments.
// Tests: Group D (Enhancement 2)
// Self-contained — do NOT combine with "bills" scenario (overlapping SoFi/Edison data).
// Adds its own bill emails showing:
// - SoFi: amount discrepancy flagged (email says $197.50, schedule says $185.00)
// - T-Mobile: 1:1 match suppressed (hasBill: false, no extractedBill)
// - Edison: new bill, no matching schedule (normal bill detection)

function relativeDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
}

function formatDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function billMatch(briefing) {
  const accounts = briefing.emails?.accounts;
  if (!accounts?.length) return;
  const now = new Date().toISOString();

  // Discrepancy: email amount differs from scheduled amount
  accounts[0].important.push({
    id: "mock-billmatch-sofi",
    message_id: "<mock-sofi-discrepancy@sofi.org>",
    from: "SoFi",
    fromEmail: "no-reply@o.sofi.org",
    subject: `Your SoFi statement balance is $197.50 — due ${formatDate(8)}`,
    preview: "Your statement balance of $197.50 is due. Autopay will process on the due date.",
    action: "SoFi $197.50 — scheduled $185.00",
    urgency: "medium",
    date: now,
    read: false,
    hasBill: true,
    extractedBill: { payee: "SoFi", amount: 197.50, due_date: relativeDate(8), type: "transfer", category_id: null, category_name: null },
    urgentFlag: null,
  });

  // 1:1 match suppressed: email AI detected a bill but it matches a scheduled payment exactly
  accounts[0].important.push({
    id: "mock-billmatch-tmobile",
    message_id: "<mock-tmobile@t-mobile.com>",
    from: "T-Mobile",
    fromEmail: "billing@t-mobile.com",
    subject: `Your T-Mobile bill is ready — $85.00 due ${formatDate(7)}`,
    preview: "Your monthly statement is ready. Autopay will process on the due date.",
    action: "FYI",
    urgency: "low",
    date: now,
    read: true,
    hasBill: false,
    extractedBill: null,
    urgentFlag: null,
    // hasBill intentionally false — simulates email AI suppressing a confident 1:1 match
  });

  // No match: genuinely new bill, no corresponding schedule
  if (accounts[1]) {
    accounts[1].important.push({
      id: "mock-billmatch-edison",
      message_id: "<mock-edison-new@sce.com>",
      from: "Edison",
      fromEmail: "billing@sce.com",
      subject: `Your Electric Bill — $62.40 Due ${formatDate(14)}`,
      preview: "Your electricity bill for the current period is $62.40.",
      action: `Pay by ${formatDate(14)}`,
      urgency: "medium",
      date: now,
      read: false,
      hasBill: true,
      extractedBill: { payee: "Edison", amount: 62.40, due_date: relativeDate(14), type: "bill", category_id: null, category_name: "Electric" },
      urgentFlag: null,
    });
    accounts[1].unread = accounts[1].important.filter(e => !e.read).length;
  }

  accounts[0].unread = accounts[0].important.filter(e => !e.read).length;

  briefing.aiInsights.unshift({ icon: "💰", text: "SoFi statement is $12.50 higher than your scheduled payment ($185.00 → $197.50). T-Mobile matches your schedule exactly — no action needed. Edison bill is new — not yet scheduled." });
}

billMatch.description = "Self-contained bill cross-reference demo — discrepancy flagged, match suppressed, new bill detected";
billMatch.category = "Email";
