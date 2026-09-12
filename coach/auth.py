"""Authentication boundary.

The whole `user_id`-injection security story is only true if `user_id` comes from a
VERIFIED token, not a request field the caller controls. This FastAPI dependency
verifies a JWT (HS256, signed with the deployment's own secret) and returns its
subject. Endpoints depend on it; no endpoint accepts a user_id in its body.

**Fail closed.** An unset `SUPABASE_JWT_SECRET` used to mean tokens were verified against
the empty string — i.e. anyone could mint a token for any user id, because the "secret"
was publicly known. The secret is now required: the service refuses to start without one
(`require_jwt_secret`, called from the lifespan) and this dependency independently refuses
to verify anything if it is missing, so a misconfigured deployment returns 500 rather than
silently authenticating strangers.
"""
from __future__ import annotations

import logging
import os

import jwt  # PyJWT
from fastapi import Header, HTTPException, status

JWT_ALG = "HS256"
JWT_AUDIENCE = "authenticated"
MIN_SECRET_LEN = 32  # 256 bits of hex; mint_token.py and the docs generate 64 hex chars

logger = logging.getLogger("coach.auth")


def jwt_secret() -> str:
    """Read the signing secret at call time (so tests/processes can set it after import)."""
    return os.environ.get("SUPABASE_JWT_SECRET", "").strip()


def require_jwt_secret() -> str:
    """Startup guard: refuse to run without a usable signing secret.

    Raises RuntimeError so the service dies loudly at boot instead of accepting forged
    tokens for the lifetime of the deployment.
    """
    secret = jwt_secret()
    if not secret:
        raise RuntimeError(
            "SUPABASE_JWT_SECRET is not set. Every endpoint authenticates with it, and an "
            "empty secret would let anyone forge a token for any user. Generate one with "
            "`python -c \"import secrets; print(secrets.token_hex(32))\"` and put it in .env."
        )
    if len(secret) < MIN_SECRET_LEN:
        logger.warning(
            "SUPABASE_JWT_SECRET is only %d characters; use at least %d (e.g. "
            "secrets.token_hex(32)) so tokens can't be brute-forced.",
            len(secret), MIN_SECRET_LEN,
        )
    return secret


async def get_current_user_id(authorization: str = Header(default="")) -> str:
    secret = jwt_secret()
    if not secret:
        # Never verify against an empty key — that authenticates everyone.
        logger.error("refusing to verify a token: SUPABASE_JWT_SECRET is not configured")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Server auth is not configured"
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALG],
            audience=JWT_AUDIENCE,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing subject")
    return user_id
