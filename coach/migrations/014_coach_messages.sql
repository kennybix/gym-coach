-- 014_coach_messages.sql — server-side chat history so conversations survive a reinstall
-- (the LangGraph checkpoint persists state but not a displayable transcript keyed for the UI).
create table if not exists coach_messages (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    thread_id  text not null,
    role       text not null,          -- 'user' | 'coach'
    text       text not null,
    evidence   jsonb,                  -- coach evidence chips, if any
    created_at timestamptz not null default now()
);
create index if not exists idx_coach_msg on coach_messages (user_id, thread_id, created_at);
