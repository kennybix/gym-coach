-- 009_food_macros.sql — full macros on each food entry (carbs, fat, fiber).
-- Calories + protein were first-class; this adds the rest so the day's macro breakdown,
-- the coach, and the energy view see complete nutrition. Day totals are summed from these.
alter table food_entries add column if not exists carbs_g numeric;
alter table food_entries add column if not exists fat_g   numeric;
alter table food_entries add column if not exists fiber_g numeric;
