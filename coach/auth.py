"""Authentication boundary.

The whole `user_id`-injection security story is only true if `user_id` comes from a
VERIFIED token, not a request field the caller controls. This FastAPI dependency
verifies a Supabase-issued JWT and returns its subject. Endpoints depend on it; no
endpoint accepts a user_id in its body.
"""
from __future__ import annotations

import os

import jwt  # PyJWT
from fastapi import Header, HTTPException, status

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
JWT_ALG = "HS256"
JWT_AUDIENCE = "authenticated"


async def get_current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=[JWT_ALG],
            audience=JWT_AUDIENCE,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing subject")
    return user_id
