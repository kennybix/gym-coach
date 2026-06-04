"""Mechanical pipeline: chunk -> embed -> store -> retrieve.

Embedder and store are pluggable. FakeEmbedder + InMemoryVectorStore make the pipeline
runnable and testable offline; in production swap a real embeddings model and pgvector.
"""
from __future__ import annotations

import hashlib
import math
from typing import Optional

from .governance import check_ingestable
from .models import Chunk, Document

DIM = 4096  # wide hash space so spurious token collisions vanish in the offline fake


class FakeEmbedder:
    """Deterministic bag-of-hashed-tokens embedding. Cosine ~ word overlap — enough to
    make retrieval meaningful in tests without an embeddings API."""
    def embed(self, text: str) -> list[float]:
        v = [0.0] * DIM
        for tok in _tokens(text):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % DIM] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]


def _tokens(text: str) -> list[str]:
    return [t for t in "".join(c.lower() if c.isalnum() else " " for c in text).split() if len(t) > 2]


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class InMemoryVectorStore:
    def __init__(self):
        self._items: list[tuple[Chunk, list[float]]] = []

    def add(self, chunk: Chunk, vector: list[float]) -> None:
        self._items.append((chunk, vector))

    def search(self, query_vec: list[float], k: int = 4) -> list[tuple[Chunk, float]]:
        scored = [(c, _cosine(query_vec, v)) for c, v in self._items]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def __len__(self):
        return len(self._items)


def chunk_document(doc: Document, size: int = 400, overlap: int = 60) -> list[Chunk]:
    text = doc.text.strip()
    chunks, i, idx = [], 0, 0
    while i < len(text):
        piece = text[i:i + size]
        chunks.append(Chunk(chunk_id=f"{doc.doc_id}:{idx}", doc_id=doc.doc_id,
                            index=idx, text=piece, provenance=doc.provenance))
        i += size - overlap
        idx += 1
    return chunks


def ingest(documents: list[Document], store: InMemoryVectorStore, embedder=None) -> dict:
    """Governance-gated ingestion. Documents that fail governance are skipped (with a
    reason) and never embedded."""
    embedder = embedder or FakeEmbedder()
    ingested, rejected = 0, []
    for doc in documents:
        try:
            check_ingestable(doc.provenance)
        except Exception as e:  # GovernanceError
            rejected.append({"doc_id": doc.doc_id, "reason": str(e)})
            continue
        for ch in chunk_document(doc):
            store.add(ch, embedder.embed(ch.text))
            ingested += 1
    return {"chunks_ingested": ingested, "rejected": rejected}


def retrieve(query: str, store: InMemoryVectorStore, embedder=None,
             k: int = 4, threshold: float = 0.12) -> list[tuple[Chunk, float]]:
    embedder = embedder or FakeEmbedder()
    hits = store.search(embedder.embed(query), k=k)
    return [(c, s) for c, s in hits if s >= threshold]
