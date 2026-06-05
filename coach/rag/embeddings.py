"""Production embedder for the RAG corpus.

The pipeline's `FakeEmbedder` is for offline tests; real retrieval needs real vectors
whose width matches the pgvector column (migration 004 = `vector(1536)`). The CLIProxyAPI
does NOT serve embeddings, so we use the shared **SmartLLMRouter** embeddings path
(Gemini @ 1536-dim, with cross-provider failover) that the trading_intelligence project
exposes — the canonical place for provider/failover logic across projects here.

Interface matches the pipeline's embedder duck-type: `.embed(text) -> list[float]`,
plus `.embed_documents(texts)` for batched ingestion.

Config (env):
    COACH_EMBED_BACKEND      litellm | router | gemini   (default: litellm)
    EMBED_DIM                vector width (default 1024; must match migration 004)
    COACH_EMBED_MODEL        model name at the gateway (default: embed-default)
    COACH_EMBED_BASE_URL     LiteLLM gateway base (default: http://localhost:4000/v1)
    COACH_EMBED_API_KEY      LiteLLM master key (or OPENAI_API_KEY)
    SMART_LLM_ROOT           [router backend] dir containing `trading_intelligence`
    SMART_LLM_ENV            [router backend] a .env to load for GEMINI_API_KEY
    GEMINI_API_KEY / GOOGLE_API_KEY   used by the 'gemini' backend / fallback
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Protocol

DEFAULT_SMART_LLM_ROOT = (
    "/home/kehinde-oyetunde/Documents/Projects/QuantOptimus/Foundational Data Generation"
)


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...


def _load_env_file(path: str) -> None:
    """Minimal KEY=VALUE loader (no dependency on python-dotenv). Existing env wins."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


class _LangchainEmbedderAdapter:
    """Wraps any langchain Embeddings object as the pipeline's `.embed` duck-type."""
    def __init__(self, lc_embeddings, name: str):
        self._e = lc_embeddings
        self.name = name

    def embed(self, text: str) -> list[float]:
        return self._e.embed_query(text)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._e.embed_documents(list(texts))


def _build_router_embedder(dim: int) -> _LangchainEmbedderAdapter:
    root = os.environ.get("SMART_LLM_ROOT", DEFAULT_SMART_LLM_ROOT)
    env_file = os.environ.get("SMART_LLM_ENV", os.path.join(root, ".env"))
    _load_env_file(env_file)  # pulls GEMINI_API_KEY from the router project's env
    os.environ.setdefault("EMBED_DIM", str(dim))
    if root not in sys.path:
        sys.path.insert(0, root)
    from trading_intelligence.agents.base.llm_router import create_embeddings_with_failover
    return _LangchainEmbedderAdapter(create_embeddings_with_failover(), "smart-router")


def _build_litellm_embedder(dim: int) -> _LangchainEmbedderAdapter:
    """OpenAI-compatible embeddings via the LiteLLM gateway (default backend).

    LiteLLM routes `embed-default` to local Ollama (mxbai-embed-large, 1024-dim) — free,
    private, no per-token cost. The dimension is fixed by the model, so we do NOT send an
    output-dimension param (Ollama would reject it; LiteLLM's drop_params also guards).
    """
    from langchain_openai import OpenAIEmbeddings
    base_url = os.environ.get("COACH_EMBED_BASE_URL", "http://localhost:4000/v1")
    api_key = os.environ.get("COACH_EMBED_API_KEY") or os.environ.get("OPENAI_API_KEY") or "sk-noauth"
    model = os.environ.get("COACH_EMBED_MODEL", "embed-default")
    e = OpenAIEmbeddings(model=model, base_url=base_url, api_key=api_key, check_embedding_ctx_length=False)
    return _LangchainEmbedderAdapter(e, "litellm")


def _build_gemini_embedder(dim: int) -> _LangchainEmbedderAdapter:
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    model = os.environ.get("COACH_EMBED_MODEL", "models/gemini-embedding-001")
    e = GoogleGenerativeAIEmbeddings(
        model=model, google_api_key=key, output_dimensionality=dim
    )
    return _LangchainEmbedderAdapter(e, "gemini")


def build_embedder(dim: int | None = None) -> Embedder:
    """Build the configured production embedder.

    Prefers the shared SmartLLMRouter (multi-provider failover); falls back to a direct
    Gemini embedder if the router isn't importable but a Google key is present.
    """
    dim = dim or int(os.environ.get("EMBED_DIM", "1024"))
    backend = os.environ.get("COACH_EMBED_BACKEND", "litellm").lower()

    if backend == "litellm":
        return _build_litellm_embedder(dim)
    if backend == "gemini":
        return _build_gemini_embedder(dim)
    if backend == "router":
        try:
            return _build_router_embedder(dim)
        except Exception as exc:  # router not present — degrade to direct Gemini
            if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
                return _build_gemini_embedder(dim)
            raise RuntimeError(
                "router backend unavailable: SmartLLMRouter import failed "
                f"({exc}) and no GEMINI_API_KEY/GOOGLE_API_KEY for the fallback."
            ) from exc
    raise ValueError(f"Unknown COACH_EMBED_BACKEND: {backend} (use litellm | router | gemini)")
