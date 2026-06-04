"""RAG domain models — provenance is first-class, not metadata bolted on."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class License(str, Enum):
    public_domain = "public_domain"
    cc0 = "cc0"
    cc_by = "cc_by"
    cc_by_sa = "cc_by_sa"
    open_gov = "open_gov"      # e.g. public-health-agency open content
    owned = "owned"
    licensed = "licensed"
    copyrighted = "copyrighted"
    unknown = "unknown"


class Provenance(BaseModel):
    source: str
    license: License
    url: Optional[str] = None
    attribution: Optional[str] = None
    review_status: str = "approved"  # 'approved' | 'pending' | 'rejected'


class Document(BaseModel):
    doc_id: str
    text: str
    provenance: Provenance


class Chunk(BaseModel):
    chunk_id: str
    doc_id: str
    index: int
    text: str
    provenance: Provenance


class Citation(BaseModel):
    source: str
    license: str
    url: Optional[str] = None
    attribution: Optional[str] = None


class CitedAnswer(BaseModel):
    answer: str
    citations: list[Citation]
    grounded: bool  # False when answered from no vetted source (or redirected)
