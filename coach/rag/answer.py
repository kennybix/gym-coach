"""Cited-answer generation over the vetted corpus.

Three guarantees:
  1. Inbound safety screen (shared with the coach): disordered-eating / self-harm /
     extreme-deficit queries get a supportive, numberless redirect to region-appropriate
     support — never a retrieved answer.
  2. Citation-required: a grounded answer always carries the provenance of the chunks it
     used. With nothing above the relevance threshold, it honestly says there's no vetted
     source rather than fabricating.
  3. Shared output guard (shared with the coach): the generated answer is screened before
     return.

Generator is pluggable: Generator (real LLM, answers ONLY from the chunks) or
FakeGenerator (deterministic, offline).
"""
from __future__ import annotations

from .. import safety
from .models import Citation, CitedAnswer
from .pipeline import retrieve

NOT_MEDICAL = " This is general information, not medical advice."
NO_SOURCE = ("I don't have a vetted source on that, so I'd rather not guess — I can only "
             "answer from our reviewed, openly-licensed references.")

REDIRECTS = safety.REDIRECTS  # single source of truth (coach + RAG share it)
GENERIC_SAFE = safety.GENERIC_SAFE


class FakeGenerator:
    """Deterministic: attributes the top chunk's first sentence. Stands in for the LLM."""
    def generate(self, query, chunks):
        top = chunks[0]
        gist = top.text.strip().split(". ")[0].rstrip(".")
        return f"According to {top.provenance.source}: {gist}."


class Generator:
    def __init__(self, model_id=None):
        import os
        from langchain.chat_models import init_chat_model
        model_id = model_id or os.environ.get("COACH_RAG_MODEL", "google_genai:gemini-3.5-flash")
        self._llm = init_chat_model(model_id, temperature=0)

    def generate(self, query, chunks):
        ctx = "\n\n".join(f"[{i}] ({c.provenance.source}) {c.text}" for i, c in enumerate(chunks))
        prompt = (
            "Answer the question USING ONLY the sources below, and cite the source you used. "
            "If the sources don't cover it, say you don't have a vetted source. Add no outside "
            "facts, numbers, or claims.\n\nSOURCES:\n" + ctx + "\n\nQUESTION: " + query
        )
        return self._llm.invoke(prompt).content


def _citations(chunks):
    seen, out = set(), []
    for c in chunks:
        key = (c.provenance.source, c.provenance.license.value)
        if key in seen:
            continue
        seen.add(key)
        out.append(Citation(source=c.provenance.source, license=c.provenance.license.value,
                            url=c.provenance.url, attribution=c.provenance.attribution))
    return out


def answer(query, store, embedder=None, generator=None, k: int = 4, threshold: float = 0.12) -> CitedAnswer:
    # 1. inbound screen — shared with the coach's safety layer
    screen = safety.screen_user_message(query)
    if screen.flagged:
        return CitedAnswer(answer=safety.redirect_for(screen.category), citations=[], grounded=False)

    # 2. retrieve from the vetted corpus
    hits = retrieve(query, store, embedder, k=k, threshold=threshold)
    if not hits:
        return CitedAnswer(answer=NO_SOURCE, citations=[], grounded=False)

    chunks = [c for c, _ in hits]
    generator = generator or FakeGenerator()
    text = generator.generate(query, chunks) + NOT_MEDICAL

    # 3. outbound guard — shared with the coach's safety layer
    if safety.screen_coach_reply(text).flagged:
        return CitedAnswer(answer=GENERIC_SAFE, citations=[], grounded=False)

    return CitedAnswer(answer=text, citations=_citations(chunks), grounded=True)
