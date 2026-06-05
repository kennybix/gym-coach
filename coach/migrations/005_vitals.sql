-- 005_vitals.sql — timestamped vitals log (blood pressure + heart rate).
-- Event log, NOT daily values: many readings per day, each editable/removable.
-- All measure columns nullable so a reading can be BP-only, HR-only, or both.
create table if not exists vitals (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(user_id) on delete cascade,
    recorded_at timestamptz not null default now(),
    systolic    int,          -- mmHg
    diastolic   int,          -- mmHg
    heart_rate  int,          -- bpm
    tag         text,         -- e.g. 'resting' | 'morning' | 'post-workout'
    note        text
);
create index if not exists idx_vitals_user_time on vitals (user_id, recorded_at desc);
