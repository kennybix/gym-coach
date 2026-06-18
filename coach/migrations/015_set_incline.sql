-- 015_set_incline.sql — treadmill/cardio incline (%) so the ACSM energy estimate can factor grade.
alter table set_logs add column if not exists incline_pct numeric;
