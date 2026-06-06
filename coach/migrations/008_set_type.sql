-- 008_set_type.sql — per-set type tag (normal/warmup/drop/failure). NULL = normal.
-- RPE (rate of perceived exertion) already exists on set_logs (set_logs.rpe).
alter table set_logs add column if not exists set_type text;
