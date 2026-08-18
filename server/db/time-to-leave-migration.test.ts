import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("Time to Leave migration", () => {
  const db = createClient({ url: "file::memory:" });

  afterEach(() => db.close());

  it("adds Home and dynamic reminder state while defaulting existing reminders to fixed", async () => {
    for (const file of ["001_ea_tables.sql", "010_discord_reminders.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute(`
      INSERT INTO ea_reminders
        (id, user_id, source_type, source_item_id, anchor_kind,
         anchor_at, offset_minutes, remind_at)
      VALUES ('legacy-fixed', 'u1', 'calendar_event', 'event-1',
              'event_start', '2026-08-18T20:00:00.000Z', -15,
              '2026-08-18T19:45:00.000Z')
    `);

    await db.executeMultiple(readFileSync(
      join(migrationsDir, "046_time_to_leave_foundation.sql"),
      "utf8",
    ));

    const settingsColumns = await db.execute("PRAGMA table_info('ea_settings')");
    const settingsByName = new Map(settingsColumns.rows.map((row) => [row.name, row]));
    expect(settingsByName.get("home_location_address")!.type).toBe("TEXT");
    expect(settingsByName.get("home_location_place_id")!.type).toBe("TEXT");
    expect(settingsByName.get("home_location_lat")!.type).toBe("REAL");
    expect(settingsByName.get("home_location_lng")!.type).toBe("REAL");

    const reminderColumns = await db.execute("PRAGMA table_info('ea_reminders')");
    const reminderByName = new Map(reminderColumns.rows.map((row) => [row.name, row]));
    expect(reminderByName.get("reminder_kind")!.notnull).toBe(1);
    expect(reminderByName.get("reminder_kind")!.dflt_value).toBe("'fixed'");
    expect(reminderByName.get("arrival_buffer_minutes")!.type).toBe("INTEGER");
    expect(reminderByName.get("route_status")!.type).toBe("TEXT");
    expect((await db.execute(
      "SELECT reminder_kind FROM ea_reminders WHERE id = 'legacy-fixed'",
    )).rows[0]?.reminder_kind).toBe("fixed");

    await db.execute(`
      INSERT INTO ea_reminders
        (id, user_id, reminder_kind, source_type, source_item_id,
         anchor_kind, anchor_at, offset_minutes, remind_at,
         arrival_buffer_minutes, route_duration_seconds,
         route_distance_meters, route_checked_at, next_route_check_at,
         route_status)
      VALUES ('ttl-1', 'u1', 'time_to_leave', 'calendar_event', 'event-ttl',
              'event_start', '2026-08-18T20:00:00.000Z', 0,
              '2026-08-18T19:15:00.000Z', 15, 1800, 12345,
              '2026-08-18T16:00:00.000Z', '2026-08-18T16:15:00.000Z',
              'ready')
    `);
    expect((await db.execute(
      "SELECT reminder_kind, route_status FROM ea_reminders WHERE id = 'ttl-1'",
    )).rows[0]).toMatchObject({ reminder_kind: "time_to_leave", route_status: "ready" });
  });
});
