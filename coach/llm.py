"""Model failover for every LLM surface (chat, weekly review, insight, vision, parsing).

Why this exists: on 2026-09-19 the single configured model (`openai:gpt-5.5` via the local CLI
proxy) went into a 128-hour provider cooldown. Every coach surface died with it — chat, the Home
insight, the weekly review (which crashed and wrote nothing), program design, food photos —
while the same proxy was serving dozens of other healthy models.

`COACH_MODELS` is a ranked, comma-separated list of `provider:model` ids. `FailoverModel` tries
them in order and remembers provider cooldowns (parsed from 429 bodies, e.g. `reset_seconds`) so a
model known to be cooling is skipped instantly instead of costing a round trip on every request.
Only when every model fails does it raise `CoachUnavailable`, carrying the earliest time one is
expected back — so the API/UI can say "back around Thursday 2pm" instead of "try again shortly".

Duck-typed to what the app uses: `ainvoke`, `bind_tools`, `with_structured_output`. Structured
output defaults to `method="function_calling"`: through the proxy's OpenAI shim, non-OpenAI models
ignore `response_format` and return prose, but they do honour tool calls (probed 2026-09-22).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("coach.llm")

DEFAULT_COOLDOWN_S = 120          # a 429 with no reset hint
TRANSIENT_COOLDOWN_S = 30         # 5xx / overloaded
MAX_COOLDOWN_S = 7 * 24 * 3600    # never trust a hint beyond a week


class CoachUnavailable(RuntimeError):
    """Every configured model failed. `retry_at` = epoch seconds of the earliest expected
    recovery, or None when no model gave a hint (timeouts, auth errors)."""

    def __init__(self, message: str, retry_at: Optional[float] = None, errors: Optional[list] = None):
        super().__init__(message)
        self.retry_at = retry_at
        self.errors = errors or []


@dataclass
class _Health:
    cooling_until: float = 0.0
    last_error: str = ""
    last_ok: float = 0.0
    failures: int = 0


@dataclass
class _Registry:
    """Process-wide model health. Each process (API, review batch) keeps its own."""
    health: dict[str, _Health] = field(default_factory=dict)

    def get(self, name: str) -> _Health:
        return self.health.setdefault(name, _Health())

    def snapshot(self, names: list[str]) -> list[dict]:
        now = time.time()
        out = []
        for n in names:
            h = self.get(n)
            out.append({
                "model": n,
                "available": h.cooling_until <= now,
                "cooling_until": h.cooling_until if h.cooling_until > now else None,
                "last_error": h.last_error or None,
                "last_ok": h.last_ok or None,
            })
        return out


REGISTRY = _Registry()


def configured_models() -> list[str]:
    """Ranked model ids from COACH_MODELS, else the single COACH_MODEL (back-compat)."""
    raw = os.environ.get("COACH_MODELS", "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    return [os.environ.get("COACH_MODEL", "google_genai:gemini-3.5-flash")]


def _cooldown_from(exc: Exception) -> Optional[float]:
    """Seconds a provider asked us to wait, or None if this error isn't a capacity signal."""
    status = getattr(exc, "status_code", None)
    text = str(exc)
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        text += " " + json.dumps(body)
    if status == 429 or "429" in text[:40] or "cooldown" in text or "usage_limit" in text:
        m = re.search(r"reset_seconds['\"]?\s*[:=]\s*(\d+)", text)
        if m:
            return min(float(m.group(1)), MAX_COOLDOWN_S)
        m = re.search(r"retry[- ]after['\"]?\s*[:=]\s*(\d+)", text, re.I)
        if m:
            return min(float(m.group(1)), MAX_COOLDOWN_S)
        return DEFAULT_COOLDOWN_S
    if status in (500, 502, 503, 504, 529) or "overloaded" in text.lower():
        return TRANSIENT_COOLDOWN_S
    return None


def _short(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc)[:160]}"


def _init(model_id: str, temperature: Optional[float]):
    from langchain.chat_models import init_chat_model

    kwargs: dict[str, Any] = {"timeout": 90, "max_retries": 1}
    # Anthropic rejects `temperature` on recent Claude models; omit it for claude-* ids.
    if temperature is not None and "claude" not in model_id.lower():
        kwargs["temperature"] = temperature
    return init_chat_model(model_id, **kwargs)


class FailoverModel:
    """Tries each model in order; skips ones known to be cooling; raises CoachUnavailable last."""

    def __init__(self, entries: list[tuple[str, Any]], registry: _Registry = REGISTRY):
        if not entries:
            raise ValueError("FailoverModel needs at least one model")
        self._entries = entries
        self._registry = registry

    # -- composition (returns a new FailoverModel over transformed models) -----------------------
    def bind_tools(self, tools, **kw) -> "FailoverModel":
        return FailoverModel([(n, m.bind_tools(tools, **kw)) for n, m in self._entries], self._registry)

    def with_structured_output(self, schema, **kw) -> "FailoverModel":
        kw.setdefault("method", "function_calling")
        return FailoverModel(
            [(n, m.with_structured_output(schema, **kw)) for n, m in self._entries], self._registry
        )

    @property
    def names(self) -> list[str]:
        return [n for n, _ in self._entries]

    # -- invocation --------------------------------------------------------------------------------
    async def ainvoke(self, input, config=None, **kw):
        now = time.time()
        errors: list[tuple[str, str]] = []
        tried_any = False
        for name, model in self._entries:
            h = self._registry.get(name)
            if h.cooling_until > now:
                errors.append((name, f"cooling until {time.strftime('%a %H:%M', time.localtime(h.cooling_until))}"))
                continue
            tried_any = True
            try:
                out = await model.ainvoke(input, config=config, **kw)
            except Exception as exc:  # noqa: BLE001 — any provider failure means "try the next one"
                wait = _cooldown_from(exc)
                h.failures += 1
                h.last_error = _short(exc)
                if wait:
                    h.cooling_until = time.time() + wait
                logger.warning("model %s failed (%s)%s", name, h.last_error,
                               f"; cooling {int(wait)}s" if wait else "")
                errors.append((name, h.last_error))
                continue
            h.last_ok = time.time()
            h.failures = 0
            if name != self._entries[0][0]:
                logger.info("served by fallback model %s", name)
            return out

        if not tried_any:
            # Everything is known to be cooling. Retry the soonest-recovering model anyway: the
            # provider's hint is an upper bound and credentials are sometimes restored early.
            soonest = min(self._entries, key=lambda e: self._registry.get(e[0]).cooling_until)
            try:
                out = await soonest[1].ainvoke(input, config=config, **kw)
                h = self._registry.get(soonest[0])
                h.cooling_until, h.last_ok, h.failures = 0.0, time.time(), 0
                return out
            except Exception as exc:  # noqa: BLE001
                errors.append((soonest[0], _short(exc)))

        retry_at = self.retry_at()
        raise CoachUnavailable(
            "every configured model failed: " + "; ".join(f"{n} ({e})" for n, e in errors),
            retry_at=retry_at,
            errors=errors,
        )

    def invoke(self, input, config=None, **kw):
        """Synchronous twin of `ainvoke` (the RAG answerer is sync). Same order, same cooldowns."""
        now = time.time()
        errors: list[tuple[str, str]] = []
        candidates = [e for e in self._entries if self._registry.get(e[0]).cooling_until <= now]
        if not candidates:  # everything cooling: probe the soonest-recovering one
            candidates = [min(self._entries, key=lambda e: self._registry.get(e[0]).cooling_until)]
        for name, model in candidates:
            h = self._registry.get(name)
            try:
                out = model.invoke(input, config=config, **kw)
            except Exception as exc:  # noqa: BLE001
                wait = _cooldown_from(exc)
                h.failures += 1
                h.last_error = _short(exc)
                if wait:
                    h.cooling_until = time.time() + wait
                logger.warning("model %s failed (%s)", name, h.last_error)
                errors.append((name, h.last_error))
                continue
            h.cooling_until, h.last_ok, h.failures = 0.0, time.time(), 0
            return out
        raise CoachUnavailable(
            "every configured model failed: " + "; ".join(f"{n} ({e})" for n, e in errors),
            retry_at=self.retry_at(), errors=errors,
        )

    def retry_at(self) -> Optional[float]:
        now = time.time()
        waits = [self._registry.get(n).cooling_until for n in self.names]
        future = [w for w in waits if w > now]
        return min(future) if len(future) == len(waits) and future else None


def build_model(temperature: Optional[float] = 0.2, models: Optional[list[str]] = None) -> FailoverModel:
    """The one constructor every surface uses. Models that fail to construct (missing provider
    package, bad id) are logged and skipped; if none construct, the caller's own error handling
    (coach optional at startup) takes over."""
    entries = []
    for mid in models or configured_models():
        try:
            entries.append((mid, _init(mid, temperature)))
        except Exception as exc:  # noqa: BLE001
            logger.warning("skipping model %s: %s", mid, _short(exc))
    if not entries:
        raise RuntimeError("no LLM could be constructed from COACH_MODELS/COACH_MODEL")
    return FailoverModel(entries)


def status(models: Optional[list[str]] = None) -> dict:
    """Health snapshot for /coach/status and the UI."""
    names = models or configured_models()
    snap = REGISTRY.snapshot(names)
    available = [s for s in snap if s["available"]]
    future = [s["cooling_until"] for s in snap if s["cooling_until"]]
    return {
        "available": bool(available),
        "active_model": available[0]["model"] if available else None,
        "retry_at": min(future) if not available and future else None,
        "models": snap,
    }
