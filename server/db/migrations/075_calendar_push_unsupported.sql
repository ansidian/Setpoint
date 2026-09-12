-- Google-managed calendars can be readable while rejecting events.watch.
-- Cache only that explicit capability response for the attempted watch lifetime.
ALTER TABLE ea_calendar_push_channels
  ADD COLUMN push_unsupported INTEGER NOT NULL DEFAULT 0;
