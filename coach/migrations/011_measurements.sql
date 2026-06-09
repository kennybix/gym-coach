-- 011_measurements.sql — body measurements over time (one set per day, upserted).
-- Circumferences in cm + body-fat %. These are health/fat-loss metrics, not appearance.
create table if not exists body_measurements (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references profiles(user_id) on delete cascade,
    recorded_on  date not null,
    waist_cm     numeric,
    chest_cm     numeric,
    hips_cm      numeric,
    arm_cm       numeric,
    thigh_cm     numeric,
    neck_cm      numeric,
    body_fat_pct numeric,
    note         text,
    created_at   timestamptz not null default now(),
    unique (user_id, recorded_on)
);
create index if not exists idx_measure_user_day on body_measurements (user_id, recorded_on desc);
