-- 007_cardio.sql — cardio logging. A cardio set records duration + distance instead of
-- reps + weight (which stay null for cardio). Detected from the exercise's catalog category.
alter table set_logs add column if not exists duration_s int;   -- seconds
alter table set_logs add column if not exists distance_m  int;   -- meters
