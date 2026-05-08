import { describe, expect, it } from "vitest";
import { normalizeIndexedSearchResults } from "./indexedSearchModel.js";

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
