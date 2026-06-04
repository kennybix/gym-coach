#!/usr/bin/env python3
"""Mint a bearer token for the app (single-user setup).

    SUPABASE_JWT_SECRET=... python3 mint_token.py [existing-user-uuid]

Prints the user id and a 1-year token to paste into the app's SETUP tab.
Keep the secret out of the repo; set it only in the server environment.
"""
import os, sys, time, uuid
import jwt

secret = os.environ["SUPABASE_JWT_SECRET"]
uid = sys.argv[1] if len(sys.argv) > 1 else str(uuid.uuid4())
tok = jwt.encode({"sub": uid, "aud": "authenticated", "exp": int(time.time()) + 365 * 86400},
                 secret, algorithm="HS256")
print(f"user_id: {uid}\ntoken:   {tok}")
