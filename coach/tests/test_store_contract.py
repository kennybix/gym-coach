"""Proves the pgvector store is a drop-in for the in-memory one.

The in-memory store is checked behaviourally; the pgvector store is checked
structurally (same public methods + signatures) so it slots into retrieve()/answer()
without code changes. Behavioural pgvector testing needs a live database.
"""
import inspect

from coach.rag.models import Chunk, License, Provenance
from coach.rag.pipeline import FakeEmbedder, InMemoryVectorStore
from coach.rag.pgvector_store import PgVectorStore


def _chunk(i, text):
    return Chunk(chunk_id=f"c{i}", doc_id="d", index=i, text=text,
                 provenance=Provenance(source="S", license=License.public_domain))


def test_inmemory_store_behaviour():
    store, emb = InMemoryVectorStore(), FakeEmbedder()
    store.add(_chunk(0, "protein supports muscle"), emb.embed("protein supports muscle"))
    store.add(_chunk(1, "sleep aids recovery"), emb.embed("sleep aids recovery"))
    assert len(store) == 2
    hits = store.search(emb.embed("protein"), k=2)
    assert hits and "protein" in hits[0][0].text
    assert hits[0][1] >= hits[-1][1]  # descending by score


def test_pgvector_is_drop_in_compatible():
    for name in ("add", "search", "__len__"):
        assert hasattr(PgVectorStore, name), f"missing {name}"
    params = lambda f: list(inspect.signature(f).parameters)[1:]  # drop self
    assert params(PgVectorStore.add) == params(InMemoryVectorStore.add)
    assert params(PgVectorStore.search) == params(InMemoryVectorStore.search)
