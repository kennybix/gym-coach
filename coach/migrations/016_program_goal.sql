-- 016_program_goal.sql — a short goal/description per program, for the multi-program library
-- (e.g. "Pelvic floor", "5k base"). Lets users keep several programs and switch/run in parallel.
alter table programs add column if not exists goal text;
