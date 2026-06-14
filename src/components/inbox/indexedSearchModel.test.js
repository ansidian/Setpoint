import { describe, expect, it } from "vitest";
import { normalizeIndexedSearchResults } from "./indexedSearchModel.js";
import { composeReadOverrides } from "./inboxRow.js";

describe("normalizeIndexedSearchResults", () => {
  it("preserves top-level globally ranked result order across accounts", () => {
    const data = {
      query: "tuition",
      results: [
        {
          uid: "work-older",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from_name: "Bursar",
          from_address: "billing@school.edu",
          subject: "Tuition receipt ready",
          body_snippet: "Payment confirmation.",
          email_date: "2026-04-20T12:00:00Z",
          read: true,
        },
        {
          uid: "personal-newer",
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          from_name: "Newsletter",
          from_address: "deals@example.com",
          subject: "Weekend digest",
          body_snippet: "Tuition mention.",
          email_date: "2026-05-06T12:00:00Z",
          read: false,
        },
      ],
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [{ uid: "personal-newer" }],
        },
        {
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          results: [{ uid: "work-older" }],
        },
      ],
    };

    const normalized = normalizeIndexedSearchResults(data, {});

    expect(normalized.emails.map((email) => email.uid)).toEqual([
      "work-older",
      "personal-newer",
    ]);
    expect(normalized.accountsById["gmail-work"]).toEqual(expect.objectContaining({
      name: "Work",
      email: "work@example.com",
    }));
  });

  it("falls back to legacy grouped account results when top-level results are absent", () => {
    const normalized = normalizeIndexedSearchResults({
      query: "amazon",
      accounts: [
        {
          account_id: "gmail-personal",
          account_label: "Personal",
          account_email: "personal@example.com",
          account_color: "#cba6da",
          account_icon: "Mail",
          results: [
            {
              uid: "personal-first",
              from_name: "Amazon",
              from_address: "store@example.com",
              subject: "Amazon receipt",
              body_snippet: "Receipt",
              email_date: "2026-05-01T12:00:00Z",
              read: true,
            },
          ],
        },
      ],
    }, {});

    expect(normalized.emails.map((email) => email.uid)).toEqual(["personal-first"]);
    expect(normalized.emails[0]).toEqual(expect.objectContaining({
      account_id: "gmail-personal",
      account_label: "Personal",
      _indexedSearch: true,
    }));
  });

  it("reconciles a fresh response against a local indexed-search read toggle (P3-21)", () => {
    // Repro: user marks a search hit unread (local override only, not in
    // liveReadOverrides), then immediately searches again. The fresh server
    // response still reports read=true; the carried-forward local search
    // override must win so the row does not flash the pre-toggle read state.
    const liveReadOverrides = {};
    const searchReadOverrides = new Map([["search-hit", false]]);
    const data = {
      query: "invoice",
      results: [{
        uid: "search-hit",
        account_id: "gmail-work",
        from_name: "Vendor",
        from_address: "billing@example.com",
        subject: "Invoice attached",
        body_snippet: "See attached.",
        email_date: "2026-05-09T12:00:00Z",
        read: true,
      }],
      accounts: [],
    };

    const stale = normalizeIndexedSearchResults(data, liveReadOverrides);
    expect(stale.emails[0].read).toBe(true); // unpatched merge: server read wins

    const reconciled = normalizeIndexedSearchResults(
      data,
      composeReadOverrides(liveReadOverrides, searchReadOverrides),
    );
    expect(reconciled.emails[0].read).toBe(false); // local toggle survives
  });

  it("keeps live read overrides applied when no local search toggle exists", () => {
    const reconciled = normalizeIndexedSearchResults(
      {
        query: "receipt",
        results: [{
          uid: "live-hit",
          account_id: "gmail-personal",
          from_name: "Store",
          from_address: "store@example.com",
          subject: "Receipt",
          body_snippet: "Thanks",
          email_date: "2026-05-09T12:00:00Z",
          read: false,
        }],
        accounts: [],
      },
      composeReadOverrides({ "live-hit": true }, new Map()),
    );
    expect(reconciled.emails[0].read).toBe(true);
  });

  it("preserves triaged bill metadata for bill-pay form seeding", () => {
    const normalized = normalizeIndexedSearchResults({
      query: "payment",
      results: [{
        uid: "bill-email",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        from_name: "Power Utility",
        from_address: "billing@example.com",
        subject: "Payment due",
        body_snippet: "Your bill is ready.",
        email_date: "2026-05-08T12:00:00Z",
        read: false,
        hasBill: true,
        extractedBill: {
          payee: "Power Utility",
          amount: 25,
          due_date: "2026-05-10",
          type: "expense",
        },
      }],
      accounts: [],
    }, {});

    expect(normalized.emails[0]).toMatchObject({
      hasBill: true,
      extractedBill: {
        payee: "Power Utility",
        amount: 25,
        due_date: "2026-05-10",
        type: "expense",
      },
    });
  });
});
