-- 010_meals.sql — saved meals: a named bundle of foods you eat often, logged in one tap.
-- Items are a JSON snapshot of foods (name/brand/grams + kcal + macros) so a meal stays
-- stable even if Open Food Facts data later changes. Logging a meal expands its items into
-- ordinary food_entries for the day.
create table if not exists meals (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    name       text not null,
    items      jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_meals_user on meals (user_id, created_at desc);
