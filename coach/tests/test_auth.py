"""The auth boundary must fail CLOSED.

Regression test for the worst possible misconfiguration: with no signing secret, PyJWT will
happily verify a token signed with the empty string, so anyone could mint a token for any
user id. The service must refuse to start, and the dependency must refuse to verify.
"""
import asyncio
import datetime as dt

import jwt
import pytest
from fastapi import HTTPException

from coach import auth


def _token(secret: str, sub: str = "11111111-1111-1111-1111-111111111111") -> str:
    return jwt.encode(
        {"sub": sub, "aud": auth.JWT_AUDIENCE,
         "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)},
        secret, algorithm=auth.JWT_ALG,
    )


def test_startup_refuses_without_a_secret(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_JWT_SECRET"):
        auth.require_jwt_secret()
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "   ")  # whitespace is not a secret
    with pytest.raises(RuntimeError):
        auth.require_jwt_secret()


def test_startup_accepts_a_real_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "a" * 64)
    assert auth.require_jwt_secret() == "a" * 64


def test_forged_token_is_rejected_when_the_secret_is_missing(monkeypatch):
    """The attack: sign with "" and walk in as anyone."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    forged = _token("", sub="attacker-chosen")
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.get_current_user_id(authorization=f"Bearer {forged}"))
    assert e.value.status_code == 500  # misconfigured, NOT authenticated


def test_valid_token_round_trips(monkeypatch):
    secret = "b" * 64
    monkeypatch.setenv("SUPABASE_JWT_SECRET", secret)
    uid = asyncio.run(auth.get_current_user_id(authorization=f"Bearer {_token(secret)}"))
    assert uid == "11111111-1111-1111-1111-111111111111"


def test_token_signed_with_another_secret_is_rejected(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "b" * 64)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.get_current_user_id(authorization=f"Bearer {_token('c' * 64)}"))
    assert e.value.status_code == 401


def test_missing_and_malformed_headers_are_rejected(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "b" * 64)
    for header in ("", "Basic abc", "Bearer not-a-jwt"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(auth.get_current_user_id(authorization=header))
        assert e.value.status_code == 401
