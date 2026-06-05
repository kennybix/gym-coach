"""pgvector-backed VectorStore — a drop-in for InMemoryVectorStore.

Same sync interface (add / search / __len__), so it slots into retrieve()/answer()
with no other changes. Uses psycopg (sync) + pgvector; heavy imports are lazy so this
module imports fine without psycopg installed (the contract test relies on that).

Because it's sync, call the knowledge pipeline from a threadpool in the async FastAPI
route (or make that route `def`). Requires: pip install "psycopg[binary]" pgvector, and
migration 004_pgvector.sql. The vector dimension MUST match your embeddings model.

NOT exercised in this environment (needs a live pgvector database); verified structurally
against the InMemoryVectorStore interface by test_store_contract.py.
"""
from __future__ import annotations

import json

from .models import Chunk, License, Provenance


class PgVectorStore:
    def __init__(self, dsn: str):
        self._dsn = dsn
        self._conn = None

    def _connection(self):
        if self._conn is None:
            import psycopg
            from pgvector.psycopg import register_vector
            self._conn = psycopg.connect(self._dsn, autocommit=True)
            register_vector(self._conn)
        return self._conn

    def add(self, chunk: Chunk, vector) -> None:
        self._connection().execute(
            """insert into rag_chunks (chunk_id, doc_id, idx, text, provenance, embedding)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (chunk_id) do update set embedding = excluded.embedding""",
            (chunk.chunk_id, chunk.doc_id, chunk.index, chunk.text,
             _provenance_json(chunk.provenance), _as_vector(vector)),
        )

    def search(self, query_vec, k: int = 4):
        qv = _as_vector(query_vec)
        rows = self._connection().execute(
            """select chunk_id, doc_id, idx, text, provenance,
                      1 - (embedding <=> %s) as score
               from rag_chunks
               order by embedding <=> %s
               limit %s""",
            (qv, qv, k),
        ).fetchall()
        return [(_row_to_chunk(r), float(r[5])) for r in rows]

    def __len__(self) -> int:
        return self._connection().execute("select count(*) from rag_chunks").fetchone()[0]


def _as_vector(vector):
    """Coerce a plain list[float] to a numpy float32 array so pgvector's psycopg adapter
    types it as `vector` (a bare list is sent as double precision[], which the `<=>`
    operator can't take)."""
    import numpy as np
    if isinstance(vector, np.ndarray):
        return vector.astype(np.float32)
    return np.asarray(vector, dtype=np.float32)


def _provenance_json(p: Provenance) -> str:
    return json.dumps({
        "source": p.source, "license": p.license.value, "url": p.url,
        "attribution": p.attribution, "review_status": p.review_status,
    })


def _row_to_chunk(r) -> Chunk:
    pj = r[4] if isinstance(r[4], dict) else json.loads(r[4])
    return Chunk(
        chunk_id=r[0], doc_id=r[1], index=r[2], text=r[3],
        provenance=Provenance(
            source=pj["source"], license=License(pj["license"]), url=pj.get("url"),
            attribution=pj.get("attribution"), review_status=pj.get("review_status", "approved"),
        ),
    )
