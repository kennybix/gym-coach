-- 017_program_schedule.sql — weekly schedule per program: which weekdays it runs (0=Sun..6=Sat).
-- NULL/empty = every day (e.g. a daily kegels/mobility routine). Drives the Today view.
alter table programs add column if not exists scheduled_days int[];
