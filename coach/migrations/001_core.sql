-- 001_core.sql — portable core schema (runs on plain Postgres and Supabase).
-- The exercise catalog itself is seed-loaded into the app (see ingest.py); program
-- slots reference catalog exercise_ids as plain text, not a DB foreign key.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

create table profiles (
    user_id           uuid primary key,
    sex               text not null check (sex in ('male','female','other')),
    birth_year        int  not null,
    height_cm         numeric not null,
    activity_level    text not null,
    goal_weight_kg    numeric not null,
    weekly_rate_kg    numeric not null,
    medical_flags     jsonb not null default '[]'::jsonb,
    current_target_id uuid,
    created_at        timestamptz not null default now()
);

create table targets (
    target_id   uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(user_id) on delete cascade,
    daily_kcal  int  not null,
    protein_g   int  not null,
    source      text not null check (source in ('onboarding','coach_review','coach_chat','manual')),
    rationale   text not null,
    created_at  timestamptz not null default now()
);
create index idx_targets_user_created on targets (user_id, created_at desc);

create table body_metrics (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(user_id) on delete cascade,
    recorded_at timestamptz not null default now(),
    weight_kg   numeric
);
create index idx_body_user_time on body_metrics (user_id, recorded_at);

create table programs (
    program_id        uuid primary key default gen_random_uuid(),
    user_id           uuid not null references profiles(user_id) on delete cascade,
    name              text not null,
    sessions_per_week int  not null default 3,  -- planned cadence; used by adherence math
    is_active         boolean not null default true,
    created_at        timestamptz not null default now()
);
create index idx_programs_user_active on programs (user_id, is_active);

create table program_exercises (
    program_exercise_id uuid primary key default gen_random_uuid(),
    program_id          uuid not null references programs(program_id) on delete cascade,
    exercise_id         text not null,   -- references the seed catalog, not a DB FK
    position            int  not null default 0,
    sets                int,
    reps                int,
    load_kg             numeric
);
create index idx_progex_program on program_exercises (program_id);

create table sessions (
    session_id   uuid primary key default gen_random_uuid(),
    user_id      uuid not null references profiles(user_id) on delete cascade,
    program_id   uuid references programs(program_id) on delete set null,
    started_at   timestamptz not null default now(),
    completed_at timestamptz
);
create index idx_sessions_user_done on sessions (user_id, completed_at);

create table set_logs (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references sessions(session_id) on delete cascade,
    user_id     uuid not null references profiles(user_id) on delete cascade,
    exercise_id text not null,
    reps        int,
    weight_kg   numeric,
    rpe         numeric,
    logged_at   timestamptz not null default now()
);
create index idx_setlogs_user_time on set_logs (user_id, logged_at);

-- Day-level nutrition for v1 (one row per logged day); item-level can come later.
create table nutrition_logs (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    logged_on  date not null,
    kcal       int,
    protein_g  numeric,
    created_at timestamptz not null default now(),
    unique (user_id, logged_on)
);
create index idx_nutrition_user_day on nutrition_logs (user_id, logged_on);

create table coach_reviews (
    review_id  uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    status     text not null,
    summary    text not null,
    changes    jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index idx_reviews_user_created on coach_reviews (user_id, created_at desc);
