import { describe, expect, it } from "vitest";

import { getInboxTriageActivity } from "./inboxProcessingModel.js";

describe("inboxProcessingModel", () => {
  it("does not treat queued email triage jobs as visible processing", () => {
    expect(getInboxTriageActivity({
      active: true,
      total: 3,
      queued: 3,
      running: 0,
      email_triage: {
        active: true,
        total: 3,
        queued: 3,
        pending: 3,
        running: 0,
      },
      gmail_history_sync: {
        active: false,
        total: 0,
        queued: 0,
        pending: 0,
        running: 0,
      },
    })).toEqual({
      processingCount: 0,
      syncing: false,
    });
  });

  it("keeps running triage and Gmail history sync visible as active work", () => {
    expect(getInboxTriageActivity({
      email_triage: {
        active: true,
        total: 3,
        queued: 2,
        pending: 2,
        running: 1,
      },
      gmail_history_sync: {
        active: false,
        total: 0,
        queued: 0,
        pending: 0,
        running: 0,
      },
    })).toEqual({
      processingCount: 1,
      syncing: true,
    });

    expect(getInboxTriageActivity({
      email_triage: {
        active: false,
        total: 0,
        queued: 0,
        pending: 0,
        running: 0,
      },
      gmail_history_sync: {
        active: true,
        total: 1,
        queued: 1,
        pending: 1,
        running: 0,
      },
    })).toEqual({
      processingCount: 0,
      syncing: true,
    });
  });
});
