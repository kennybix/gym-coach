-- 012_progress_photos.sql — progress photo journal. The image bytes live on disk under
-- PHOTO_DIR/<user_id>/ (auth-gated, tailnet-only); this table is the metadata + the optional
-- coach note. coach_note is only ever written for users without eating-disorder history.
create table if not exists progress_photos (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references profiles(user_id) on delete cascade,
    taken_on   date not null,
    pose       text,                 -- front | side | back | other
    filename   text not null,        -- stored file (basename) under the per-user photo dir
    caption    text,
    coach_note text,
    created_at timestamptz not null default now()
);
create index if not exists idx_photos_user on progress_photos (user_id, taken_on desc, created_at desc);
