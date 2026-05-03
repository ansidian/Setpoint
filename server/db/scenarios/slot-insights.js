// Replaces briefing.aiInsights with a set of template+slots insights that
// exercise every branch of the frontend insight-resolver without requiring
// a real email AI API call. Useful for verifying:
//   - "tonight", "tomorrow", "this morning" rendering
//   - "last night" / "yesterday" back-references
//   - weekday rendering for >= 2 days out
//   - distant (> 6 days) absolute-date rendering
//   - new-slot minting (the kind an AI model would produce for derived dates)
//   - back-compat insights (icon + text, no template) rendering unchanged
//
// Usage: ?mock=1&scenario=slot-insights

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(dt);
}

export default function slotInsights(briefing) {
  const today = todayIso();
  const tomorrow = addDaysIso(today, 1);
  const yesterday = addDaysIso(today, -1);
  const twoDaysOut = addDaysIso(today, 2);
  const threeDaysOut = addDaysIso(today, 3);
  const twoWeeksOut = addDaysIso(today, 14);

  briefing.aiInsights = [
    // 1. "tonight at 8pm" — same-day event, evening time
    {
      icon: "🎬",
      template: "The Boys viewing is {cal_evening}. You bought the tickets last week — check your email for the QR code.",
      slots: {
        cal_evening: { iso: today, time: "20:00" },
      },
    },
    // 2. "tomorrow" — no time
    {
      icon: "📋",
      template: "Your Poo-Pourri Todoist task is due {tk_poo}. This one keeps slipping — just order it already.",
      slots: {
        tk_poo: { iso: tomorrow },
      },
    },
    // 3. Multiple slots in one insight — "yesterday at 9am" + weekday
    {
      icon: "📊",
      template: "Your Xfinity bill was charged {bill_xfinity}. Next cycle closes {bill_next}, giving you ~10 days to dispute if the amount looks wrong.",
      slots: {
        bill_xfinity: { iso: yesterday, time: "09:00" },
        bill_next: { iso: threeDaysOut },
      },
    },
    // 4. Within-week weekday rendering (e.g., "Sat") + timed morning event
    {
      icon: "🏃",
      template: "Your Sunrise Hike RSVP closes {rsvp_deadline}. The hike itself is {hike_start} — plan on a 6:30 start, not 7.",
      slots: {
        rsvp_deadline: { iso: twoDaysOut },
        hike_start: { iso: twoDaysOut, time: "06:30" },
      },
    },
    // 5. Distant absolute date (> 6 days) — weekday + month day
    {
      icon: "✈️",
      template: "Your flight to Portland departs {flight_dep}. Two weeks is a good runway for the prep list — printer tickets, boarding passes, TSA PreCheck verification.",
      slots: {
        flight_dep: { iso: twoWeeksOut, time: "07:15" },
      },
    },
    // 6. New minted slot (what a model emits when computing derived dates)
    {
      icon: "📦",
      template: "Your Amazon delivery of the travel pillow should arrive {new_delivery}, in time for your flight. No action needed — tracking email is in your Gmail.",
      slots: {
        new_delivery: { iso: addDaysIso(today, 12) },
      },
    },
    // 7. Back-compat: old-format insight with `text` only — resolver falls
    //    through unchanged. Exercises the !insight.template branch.
    {
      icon: "💡",
      text: "This is a legacy-format insight with no template field. It should render exactly as-is, proving the back-compat path works for old briefings in your history.",
    },
  ];
}

slotInsights.description = "Typed date slot insights exercising every resolver branch (tonight, tomorrow, weekday, distant, back-compat)";
slotInsights.category = "Insights";
