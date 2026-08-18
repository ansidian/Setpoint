import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDiscordReminderPayload,
  sendDiscordWebhook,
} from "./discord-reminders.ts";
import type { DiscordResponse } from "./discord-reminders.ts";
import type { FetchFunction } from "../platform/fetch-with-timeout.ts";

describe("Discord reminder delivery", () => {
  it("formats reminder payloads with mention, source context, timing, links, and fallback color", () => {
    const payload = formatDiscordReminderPayload({
      reminder: {
        source_type: "calendar_event",
        anchor_at: "2026-05-10T17:00:00.000Z",
        remind_at: "2026-05-10T16:30:00.000Z",
        offset_minutes: -30,
        payload_snapshot_json: JSON.stringify({
          title: "Dentist",
          context: "Personal calendar",
          url: "https://calendar.example/event-1",
          color: "#89b4fa",
        }),
      },
      discordUserId: "123456789",
    });

    expect(payload.content).toBe("<@123456789>");
    expect(payload.embeds[0]!).toMatchObject({
      title: "Dentist",
      url: "https://calendar.example/event-1",
      color: 9024762,
    });
    expect(payload.embeds[0]!.fields).toEqual(expect.arrayContaining([
      { name: "Source", value: "Personal calendar", inline: true },
      { name: "Reminder", value: "30 minutes before", inline: true },
    ]));
  });

  it("formats Time to Leave without leaking Home or raw route errors", () => {
    const payload = formatDiscordReminderPayload({
      reminder: {
        reminder_kind: "time_to_leave",
        source_type: "calendar_event",
        anchor_at: "2026-05-10T17:00:00.000Z",
        remind_at: "2026-05-10T16:20:00.000Z",
        offset_minutes: 0,
        arrival_buffer_minutes: 15,
        route_duration_seconds: 1_500,
        route_distance_meters: 11_200,
        payload_snapshot: {
          title: "Dentist",
          location: "500 Pine St",
          url: "https://calendar.example/event-1",
          description: "Home is 1 Secret Way; coordinates 47.61,-122.33",
        },
      },
      discordUserId: "123456789",
    });

    expect(payload.content).toBe("<@123456789>");
    expect(payload.embeds[0]).toMatchObject({
      title: "Time to leave for Dentist",
      url: "https://calendar.example/event-1",
      description: "Head to 500 Pine St.",
    });
    expect(payload.embeds[0]!.fields).toEqual(expect.arrayContaining([
      { name: "Drive", value: "About 25 minutes", inline: true },
      { name: "Arrive early", value: "15 minutes", inline: true },
    ]));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("1 Secret Way");
    expect(serialized).not.toContain("47.61");
  });

  it("reports Discord 429 backoff without dropping the reminder", async () => {
    const fetchFn = vi.fn<FetchFunction<DiscordResponse>>(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => JSON.stringify({ retry_after: 2.5 }),
    }));

    await expect(sendDiscordWebhook("https://discord.example/webhook", { embeds: [] }, { fetchFn }))
      .resolves.toMatchObject({
        ok: false,
        status: 429,
        rateLimited: true,
        retryAfterMs: 2500,
      });
  });

  it("treats successful Discord webhook status codes as sent", async () => {
    const fetchFn = vi.fn<FetchFunction<DiscordResponse>>(async () => ({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: async () => "",
    }));

    await expect(sendDiscordWebhook("https://discord.example/webhook", { embeds: [] }, { fetchFn }))
      .resolves.toEqual({ ok: true, status: 204 });
  });

  it("sends the webhook POST with an AbortSignal", async () => {
    const fetchFn = vi.fn<FetchFunction<DiscordResponse>>(async () => ({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: async () => "",
    }));

    await sendDiscordWebhook("https://discord.example/webhook", { embeds: [] }, { fetchFn });

    // test-architecture: allow-boundary-interaction -- Discord fetch is an outbound provider boundary; timeout propagation is observable only through the request signal.
    expect(fetchFn.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects after 10s when the webhook fetch never settles", async () => {
      const fetchFn = vi.fn<FetchFunction<DiscordResponse>>((_url, opts) => new Promise<DiscordResponse>((_resolve, reject) => {
        opts!.signal!.addEventListener("abort", () => reject(opts!.signal!.reason));
      }));

      const pending = sendDiscordWebhook("https://discord.example/webhook", { embeds: [] }, { fetchFn });
      pending.catch(() => {});

      await vi.advanceTimersByTimeAsync(10_001);

      await expect(pending).rejects.toThrow(/fetch timeout after 10000ms/);
    });
  });
});
