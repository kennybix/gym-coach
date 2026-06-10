-- 013_belly.sql — belly (navel) circumference, distinct from the narrowest waist. Also the
-- abdominal input the US Navy body-fat estimate uses for men.
alter table body_measurements add column if not exists belly_cm numeric;
