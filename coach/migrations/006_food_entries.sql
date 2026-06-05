-- 006_food_entries.sql — itemized food log backing the food-database nutrition logging.
-- Each row is one food added to a day; the day's nutrition_logs total is recomputed as the
-- sum of its entries, so everything downstream (summary, coach, trends) stays consistent.
create table if not exists food_entries (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    logged_on  date not null,
    name       text not null,
    brand      text,
    grams      numeric,            -- portion in grams (null if logged as a unit/serving)
    kcal       int  not null,
    protein_g  numeric,
    created_at timestamptz not null default now()
);
create index if not exists idx_food_user_day on food_entries (user_id, logged_on);
