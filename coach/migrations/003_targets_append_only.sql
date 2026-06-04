-- 003_targets_append_only.sql — enforce the append-only invariant on targets.
-- Target history (why/when a target changed) is a product feature and an audit
-- trail; protect it in the database, not just by convention. New values are
-- expressed by INSERTing a new row.
-- NOTE: insert_target legitimately updates profiles.current_target_id (a pointer),
-- which this trigger does not affect.

create or replace function targets_append_only() returns trigger as $$
begin
    raise exception 'targets is append-only: insert a new row instead of modifying history';
end $$ language plpgsql;

drop trigger if exists trg_targets_append_only on targets;
create trigger trg_targets_append_only
    before update or delete on targets
    for each row execute function targets_append_only();
