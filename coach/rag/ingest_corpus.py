"""Ingest a vetted corpus into the pgvector store.

Reads a JSON manifest of documents (each with first-class provenance), runs each through
the governance gate (license + review status), chunks, embeds with the production
embedder, and upserts into `rag_chunks` (migration 004). Idempotent: re-running replaces
a chunk's embedding (ON CONFLICT in PgVectorStore.add).

    python -m coach.rag.ingest_corpus --manifest seed/rag_corpus.json
    python -m coach.rag.ingest_corpus --manifest seed/rag_corpus.json --dry-run

Manifest = JSON list of objects:
    {
      "doc_id": "acsm-resistance-basics",
      "text": "...full document text...",
      "source": "ACSM",
      "license": "cc_by",            # must be in governance.INGESTABLE
      "url": "https://...",
      "attribution": "© ACSM, CC BY 4.0",
      "review_status": "approved"     # only 'approved' is ingested
    }

Requires COACH_DB_URI (psycopg DSN) and an embeddings backend (see embeddings.py).
Nothing that fails governance is embedded or stored — it's reported and skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from .embeddings import build_embedder
from .governance import GovernanceError, check_ingestable
from .models import Document, License, Provenance
from .pipeline import chunk_document


def _load_manifest(path: str) -> list[Document]:
    raw = json.loads(open(path).read())
    docs = []
    for d in raw:
        prov = Provenance(
            source=d["source"],
            license=License(d["license"]),
            url=d.get("url"),
            attribution=d.get("attribution"),
            review_status=d.get("review_status", "approved"),
        )
        docs.append(Document(doc_id=d["doc_id"], text=d["text"], provenance=prov))
    return docs


def main() -> None:
    p = argparse.ArgumentParser(description="Ingest a vetted corpus into pgvector.")
    p.add_argument("--manifest", required=True, help="path to the JSON corpus manifest")
    p.add_argument("--dry-run", action="store_true",
                   help="govern + chunk + embed but do NOT write to the database")
    args = p.parse_args()

    docs = _load_manifest(args.manifest)
    embedder = build_embedder()

    store = None
    if not args.dry_run:
        from .pgvector_store import PgVectorStore
        store = PgVectorStore(os.environ["COACH_DB_URI"])

    ingested_chunks, ingested_docs, rejected = 0, 0, []
    for doc in docs:
        try:
            check_ingestable(doc.provenance)
        except GovernanceError as e:
            rejected.append((doc.doc_id, str(e)))
            print(f"  SKIP {doc.doc_id}: {e}")
            continue

        chunks = chunk_document(doc)
        vectors = embedder.embed_documents([c.text for c in chunks])
        for ch, vec in zip(chunks, vectors):
            if store is not None:
                store.add(ch, vec)
            ingested_chunks += 1
        ingested_docs += 1
        print(f"  OK   {doc.doc_id}: {len(chunks)} chunks "
              f"({doc.provenance.license.value}, dim={len(vectors[0]) if vectors else 0})"
              f"{' [dry-run]' if args.dry_run else ''}")

    total = store and len(store)
    print(
        f"\ndone: {ingested_docs} docs / {ingested_chunks} chunks "
        f"{'(dry-run, nothing written)' if args.dry_run else f'-> rag_chunks now holds {total}'}; "
        f"{len(rejected)} rejected by governance"
    )
    sys.exit(1 if rejected else 0)


if __name__ == "__main__":
    main()
