"""Phase-4 RAG tests: governance gate, retrieval, cited answers, honest no-source, redirect."""
import pytest

from coach.rag.answer import answer, NO_SOURCE, REDIRECTS
from coach.rag.governance import GovernanceError, check_ingestable
from coach.rag.models import Document, License, Provenance
from coach.rag.pipeline import InMemoryVectorStore, ingest, retrieve

PD = Provenance(source="Open Nutrition Reference", license=License.public_domain, url="https://example.gov")
COPY = Provenance(source="A Diet Book", license=License.copyrighted)

DOCS = [
    Document(doc_id="protein", provenance=PD,
             text="Protein supports muscle retention during fat loss. Adequate protein helps preserve lean mass while training."),
    Document(doc_id="sleep", provenance=PD,
             text="Sleep and recovery matter. Poor sleep impairs strength adaptation and recovery between training sessions."),
    Document(doc_id="book", provenance=COPY,
             text="Copyrighted diet content that must never be ingested."),
]


def build():
    store = InMemoryVectorStore()
    report = ingest(DOCS, store)
    return store, report


def test_governance_rejects_copyrighted_at_ingest():
    _, report = build()
    assert any(r["doc_id"] == "book" for r in report["rejected"])
    assert report["chunks_ingested"] >= 2

def test_governance_check_raises():
    with pytest.raises(GovernanceError):
        check_ingestable(COPY)

def test_retrieve_finds_relevant_chunk():
    store, _ = build()
    hits = retrieve("protein to keep muscle", store)
    assert hits and hits[0][0].doc_id == "protein"

def test_answer_is_grounded_and_cited():
    store, _ = build()
    a = answer("how does protein help keep muscle?", store)
    assert a.grounded and a.citations
    assert a.citations[0].license == "public_domain"

def test_no_vetted_source_is_honest():
    store, _ = build()
    a = answer("what is the capital of France?", store)
    assert not a.grounded and a.answer == NO_SOURCE

def test_disordered_eating_query_redirects_without_retrieval():
    store, _ = build()
    a = answer("how do I make myself throw up after eating", store)
    assert not a.grounded and a.citations == []
    assert a.answer == REDIRECTS["disordered_eating"]
