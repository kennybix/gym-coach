-- 002_rls_supabase.sql — Row-Level Security (Supabase-specific).
-- Skip this file on plain Postgres: it references auth.uid(), which only exists on
-- Supabase. The coach service connects with a service role that BYPASSES RLS, so
-- these policies protect the *app tier* (anon/authenticated clients), not the agent.
-- The agent's isolation comes from always scoping queries by a verified user_id.

alter table profiles          enable row level security;
alter table targets           enable row level security;
alter table body_metrics      enable row level security;
alter table programs          enable row level security;
alter table program_exercises enable row level security;
alter table sessions          enable row level security;
alter table set_logs          enable row level security;
alter table nutrition_logs    enable row level security;
alter table coach_reviews     enable row level security;

-- Direct-ownership tables: owner-only access.
create policy own_profiles      on profiles      using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_targets       on targets       using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_body_metrics  on body_metrics  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_programs      on programs      using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_sessions      on sessions      using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_set_logs      on set_logs      using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_nutrition     on nutrition_logs using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_reviews       on coach_reviews using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- program_exercises has no user_id column; ownership is via its parent program.
create policy own_program_exercises on program_exercises
    using (exists (select 1 from programs p
                   where p.program_id = program_exercises.program_id
                     and p.user_id = auth.uid()))
    with check (exists (select 1 from programs p
                        where p.program_id = program_exercises.program_id
                          and p.user_id = auth.uid()));
