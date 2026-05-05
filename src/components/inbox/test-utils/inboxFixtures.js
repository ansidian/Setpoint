export function makeInboxEmail(overrides = {}) {
  const id = overrides.id || overrides.uid || "email-action";
  return {
    id,
    uid: id,
    subject: "Project budget sign-off",
    from: "Dana",
    fromEmail: "dana@example.com",
    date: "2026-04-19T15:30:00.000Z",
    preview: "Need your approval on the revised budget today.",
    fullBody: "Please approve the revised budget.",
    read: false,
    urgency: "high",
    ...overrides,
  };
}

export function makeInboxAccounts() {
  return [
    {
      id: "acc-work",
      name: "Work",
      email: "work@example.com",
      color: "#89dceb",
      unread: 2,
      important: [
        makeInboxEmail({
          id: "email-action",
          hasBill: true,
          extractedBill: {
            payee: "Vendor",
            amount: 125,
            due_date: "2026-04-20",
            type: "expense",
          },
          claude: {
            summary: "Requires a fast approval decision.",
            draftReply: "Approved. Please proceed.",
          },
        }),
      ],
      noise: [],
    },
    {
      id: "acc-personal",
      name: "Personal",
      email: "personal@example.com",
      color: "#cba6da",
      unread: 1,
      important: [
        makeInboxEmail({
          id: "email-fyi",
          subject: "Budget dinner plans",
          from: "Chris",
          fromEmail: "chris@example.com",
          date: "2026-04-19T14:00:00.000Z",
          preview: "Checking whether Sunday still works.",
          fullBody: "Sunday dinner still works for me.",
          urgency: undefined,
        }),
      ],
      noise: [
        makeInboxEmail({
          id: "email-noise",
          subject: "Weekly sale roundup",
          from: "Store",
          fromEmail: "store@example.com",
          date: "2026-04-18T13:00:00.000Z",
          preview: "Discounts you can ignore.",
          fullBody: "This is a marketing email.",
          read: true,
          urgency: undefined,
          noise: true,
        }),
      ],
    },
  ];
}

export function makeLiveInboxEmail(overrides = {}) {
  const uid = overrides.uid || "live-1";
  return {
    uid,
    subject: "Fresh live ping",
    from: "Morgan",
    from_email: "morgan@example.com",
    account_label: "Work",
    account_email: "work@example.com",
    account_color: "#89dceb",
    date: "2026-04-19T16:15:00.000Z",
    preview: "Just arrived after the current snapshot.",
    body_preview: "Just arrived after the current snapshot.",
    read: false,
    ...overrides,
  };
}

export function makeActiveSnapshot(overrides = {}) {
  return {
    snapshot: { id: 1, updated_at: "2026-05-03T15:00:00.000Z" },
    filters: {
      accounts: [{
        account_id: "gmail-work",
        label: "Work",
        email: "work@example.com",
        color: "#89dceb",
        icon: "Mail",
        count: 1,
      }],
      categories: [],
    },
    lanes: {
      needs_attention: [{
        id: 11,
        snapshot_item_id: 11,
        uid: "snapshot-msg-1",
        email_id: "snapshot-msg-1",
        account_id: "gmail-work",
        lane: "needs_attention",
        subject: "Snapshot action",
        from_name: "Dana",
        from_address: "dana@example.com",
        summary: "Needs a response.",
        date: "2026-05-03T15:00:00.000Z",
        read: false,
      }],
      fyi: [],
      noise: [],
    },
    carryover: [],
    processing: { active: false, queued: 0, running: 0, total: 0 },
    ...overrides,
  };
}
