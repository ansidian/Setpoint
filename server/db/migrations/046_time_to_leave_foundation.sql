ALTER TABLE ea_settings ADD COLUMN home_location_label TEXT DEFAULT NULL;
ALTER TABLE ea_settings ADD COLUMN home_location_address TEXT DEFAULT NULL;
ALTER TABLE ea_settings ADD COLUMN home_location_place_id TEXT DEFAULT NULL;
ALTER TABLE ea_settings ADD COLUMN home_location_lat REAL DEFAULT NULL;
ALTER TABLE ea_settings ADD COLUMN home_location_lng REAL DEFAULT NULL;

ALTER TABLE ea_reminders ADD COLUMN reminder_kind TEXT NOT NULL DEFAULT 'fixed'
  CHECK (reminder_kind IN ('fixed', 'time_to_leave'));
ALTER TABLE ea_reminders ADD COLUMN arrival_buffer_minutes INTEGER DEFAULT NULL
  CHECK (arrival_buffer_minutes IS NULL OR arrival_buffer_minutes BETWEEN 0 AND 120);
ALTER TABLE ea_reminders ADD COLUMN route_duration_seconds INTEGER DEFAULT NULL
  CHECK (route_duration_seconds IS NULL OR route_duration_seconds >= 0);
ALTER TABLE ea_reminders ADD COLUMN route_distance_meters INTEGER DEFAULT NULL
  CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0);
ALTER TABLE ea_reminders ADD COLUMN route_checked_at TEXT DEFAULT NULL;
ALTER TABLE ea_reminders ADD COLUMN next_route_check_at TEXT DEFAULT NULL;
ALTER TABLE ea_reminders ADD COLUMN route_status TEXT DEFAULT NULL
  CHECK (route_status IS NULL OR route_status IN ('ready', 'degraded', 'blocked'));
ALTER TABLE ea_reminders ADD COLUMN route_error_code TEXT DEFAULT NULL
  CHECK (route_error_code IS NULL OR length(route_error_code) BETWEEN 1 AND 64);
