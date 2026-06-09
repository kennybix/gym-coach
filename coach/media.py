"""Local media storage for progress photos.

Files live on this machine under PHOTO_DIR/<user_id>/, served only through the auth-gated API
(tailnet-only). Metadata is in Postgres; these helpers just handle the bytes on disk.
"""
from __future__ import annotations

import base64
import os
import re
import uuid

PHOTO_DIR = os.environ.get("PHOTO_DIR", os.path.expanduser("~/.local/share/gym-coach/photos"))

_DATA_URL = re.compile(r"^data:image/(?P<ext>[\w.+-]+);base64,(?P<b64>.+)$", re.DOTALL)


def _user_dir(user_id: str) -> str:
    d = os.path.join(PHOTO_DIR, os.path.basename(user_id))
    os.makedirs(d, exist_ok=True)
    return d


def save_data_url(user_id: str, data_url: str) -> str:
    """Decode a data: URL image and store it; returns the stored filename."""
    m = _DATA_URL.match((data_url or "").strip())
    if not m:
        raise ValueError("not a base64 image data URL")
    ext = m.group("ext").lower()
    ext = "jpg" if ext in ("jpeg", "jpg") else re.sub(r"[^a-z0-9]", "", ext)[:5] or "img"
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(_user_dir(user_id), filename), "wb") as f:
        f.write(base64.b64decode(m.group("b64")))
    return filename


def image_path(user_id: str, filename: str) -> str:
    """Absolute path of a stored file (basename-guarded against traversal)."""
    return os.path.join(_user_dir(user_id), os.path.basename(filename))


def read_data_url(user_id: str, filename: str) -> str:
    """Re-encode a stored image as a data URL (for the vision model)."""
    path = image_path(user_id, filename)
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = "jpeg" if ext == "jpg" else ext
    with open(path, "rb") as f:
        return f"data:image/{mime};base64," + base64.b64encode(f.read()).decode()


def delete_file(user_id: str, filename: str) -> None:
    try:
        os.remove(image_path(user_id, filename))
    except OSError:
        pass
