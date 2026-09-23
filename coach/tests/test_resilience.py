"""Model failover, the daily nudge rules, review notifications and push routing.

Regression tests for the 2026-09 outage: one model in a 128-hour provider cooldown took down every
coach surface, the weekly review crashed silently, and nothing ever reached the phone.
"""
import asyncio
import time
from datetime import date

import pytest

from coach import llm, notify
from coach.daily import Nudge, Snapshot, plan_nudge
from coach.run_review import review_notification, week_start


# ---------------------------------------------------------------- failover
class _RateLimited(Exception):
    status_code = 429

    def __init__(self, reset=None):
        body = {"error": {"code": "model_cooldown"}}
        if reset is not None:
            body["error"]["reset_seconds"] = reset
        self.body = body
        super().__init__(f"Error code: 429 - {body}")


class _Fake:
    def __init__(self, name, fail=None):
        self.name, self.fail, self.calls = name, fail, 0

    async def ainvoke(self, input, config=None, **kw):
        self.calls += 1
        if self.fail:
            raise self.fail
        return f"{self.name}:{input}"

    def bind_tools(self, tools, **kw):
        return self

    def with_structured_output(self, schema, **kw):
        self.structured_kw = kw
        return self


def _fm(*models):
    return llm.FailoverModel([(m.name, m) for m in models], llm._Registry())


def test_primary_serves_when_healthy():
    a, b = _Fake("a"), _Fake("b")
    assert asyncio.run(_fm(a, b).ainvoke("hi")) == "a:hi"
    assert b.calls == 0


def test_falls_back_and_remembers_cooldown():
    a, b = _Fake("a", _RateLimited(reset=3600)), _Fake("b")
    fm = _fm(a, b)
    assert asyncio.run(fm.ainvoke("x")) == "b:x"
    # the cooling model is skipped next time, not retried on every request
    assert asyncio.run(fm.ainvoke("y")) == "b:y"
    assert a.calls == 1 and b.calls == 2
    until = fm._registry.get("a").cooling_until
    assert 3500 < until - time.time() <= 3600


def test_all_down_raises_with_earliest_recovery():
    a, b = _Fake("a", _RateLimited(reset=7200)), _Fake("b", _RateLimited(reset=600))
    fm = _fm(a, b)
    with pytest.raises(llm.CoachUnavailable) as e:
        asyncio.run(fm.ainvoke("x"))
    assert e.value.retry_at is not None
    assert 500 < e.value.retry_at - time.time() <= 600  # b is back first


def test_non_capacity_error_falls_back_without_cooldown():
    a, b = _Fake("a", ValueError("bad json")), _Fake("b")
    fm = _fm(a, b)
    assert asyncio.run(fm.ainvoke("x")) == "b:x"
    assert fm._registry.get("a").cooling_until == 0.0


def test_unknown_outage_has_no_retry_time():
    fm = _fm(_Fake("a", TimeoutError("slow")), _Fake("b", ConnectionError("down")))
    with pytest.raises(llm.CoachUnavailable) as e:
        asyncio.run(fm.ainvoke("x"))
    assert e.value.retry_at is None


def test_everything_cooling_still_probes_the_soonest():
    a, b = _Fake("a"), _Fake("b")
    fm = _fm(a, b)
    fm._registry.get("a").cooling_until = time.time() + 900
    fm._registry.get("b").cooling_until = time.time() + 60
    assert asyncio.run(fm.ainvoke("x")) == "b:x"  # credentials came back early
    assert fm._registry.get("b").cooling_until == 0.0


def test_structured_output_defaults_to_function_calling():
    a = _Fake("a")
    _fm(a).with_structured_output(dict)
    assert a.structured_kw["method"] == "function_calling"


def test_cooldown_parsing():
    assert llm._cooldown_from(_RateLimited(reset=461056)) == 461056
    assert llm._cooldown_from(_RateLimited()) == llm.DEFAULT_COOLDOWN_S
    assert llm._cooldown_from(ValueError("nope")) is None
    assert llm._cooldown_from(_RateLimited(reset=10**9)) == llm.MAX_COOLDOWN_S


def test_configured_models(monkeypatch):
    monkeypatch.setenv("COACH_MODELS", "openai:a, openai:b ,")
    assert llm.configured_models() == ["openai:a", "openai:b"]
    monkeypatch.delenv("COACH_MODELS")
    monkeypatch.setenv("COACH_MODEL", "openai:solo")
    assert llm.configured_models() == ["openai:solo"]


# ---------------------------------------------------------------- daily nudge
MON, TUE = date(2026, 9, 28), date(2026, 9, 29)


def _snap(**kw):
    base = dict(ed_history=False, workout_name="Main", workout_exercises=6, workout_minutes=40,
                last_weigh_in=date(2026, 9, 27), last_activity=date(2026, 9, 27))
    base.update(kw)
    return Snapshot(**base)


def test_active_user_gets_a_workout_nudge():
    n = plan_nudge(_snap(last_weigh_in=date(2026, 9, 28)), TUE)  # weighed in yesterday
    assert isinstance(n, Nudge) and n.title == "Good morning"
    assert ("Start workout", "workout") in n.actions
    assert not any(k == "weight" for _, k in n.actions)


def test_weigh_in_prompt_after_a_gap():
    n = plan_nudge(_snap(last_weigh_in=date(2026, 9, 25)), TUE)
    assert ("Weigh in", "weight") in n.actions


def test_ed_history_never_gets_weigh_in_prompts():
    n = plan_nudge(_snap(ed_history=True, last_weigh_in=None), TUE)
    assert n is not None and not any(k == "weight" for _, k in n.actions)
    assert plan_nudge(_snap(ed_history=True, workout_exercises=0, last_weigh_in=None), TUE) is None


def test_nothing_to_do_means_no_notification():
    assert plan_nudge(_snap(workout_exercises=0, last_weigh_in=date(2026, 9, 29)), TUE) is None


def test_dormant_users_are_only_nudged_on_mondays():
    quiet = _snap(last_activity=date(2026, 8, 11), last_weigh_in=date(2026, 7, 5))
    assert plan_nudge(quiet, TUE) is None
    n = plan_nudge(quiet, MON)
    assert n.title == "New week, fresh start"
    assert "No catching up needed" in n.message


def test_nudge_copy_has_no_guilt_or_numbers_about_weight():
    n = plan_nudge(_snap(last_weigh_in=None, last_activity=date(2026, 8, 1)), MON)
    for bad in ("missed", "streak", "kg", "behind", "failed"):
        assert bad not in n.message.lower()


# ---------------------------------------------------------------- review push
def test_review_notification_headline_and_target_change():
    t, m = review_notification("on_track", "Solid week.", {"target_change": {
        "new_daily_kcal": 2050, "previous_daily_kcal": 2281}})
    assert t == "Weekly review · On track"
    assert "2281 → 2050 kcal/day" in m


def test_review_notification_unknown_status_is_readable():
    t, _ = review_notification("some_new_state", "x", {})
    assert t == "Weekly review · Some New State"


def test_week_start_is_monday():
    assert week_start(date(2026, 9, 24)) == date(2026, 9, 21)
    assert week_start(date(2026, 9, 21)) == date(2026, 9, 21)


# ---------------------------------------------------------------- push routing
def test_links_default_to_the_app_and_can_use_the_web(monkeypatch):
    monkeypatch.delenv("COACH_NOTIFY_LINKS", raising=False)
    assert notify.link("weight") == "gymcoach://log/weight"
    monkeypatch.setenv("COACH_NOTIFY_LINKS", "web")
    monkeypatch.setenv("COACH_PUBLIC_URL", "https://gym.example")
    assert notify.link("weight") == "https://gym.example/?log=weight"


def test_push_is_limited_to_listed_accounts(monkeypatch):
    monkeypatch.setenv("COACH_NOTIFY_USERS", "u1, u2")
    assert notify.wants("u1") and not notify.wants("u3")
    monkeypatch.setenv("COACH_NOTIFY_USERS", "")
    assert notify.wants("anyone")


def test_unconfigured_push_is_a_quiet_no_op(monkeypatch):
    for k in ("COACH_NTFY_URL", "COACH_NTFY_PUBLISH_URL", "COACH_NTFY_TOPIC"):
        monkeypatch.delenv(k, raising=False)
    assert notify.send("t", "m") is False
