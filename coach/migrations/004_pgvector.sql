-- 004_pgvector.sql — vector store for the RAG corpus (Postgres + pgvector).
create extension if not exists vector;

create table if not exists rag_chunks (
    chunk_id   text primary key,
    doc_id     text not null,
    idx        int  not null,
    text       text not null,
    provenance jsonb not null,
    -- Dimension MUST match your embeddings model. Default here = mxbai-embed-large (1024),
    -- served locally by Ollama via the LiteLLM gateway (free). If you switch models, change
    -- this (e.g. gemini-embedding-001 -> 1536, nomic-embed-text -> 768) and re-create.
    embedding  vector(1024) not null
);

-- Cosine-distance ANN index. HNSW (not ivfflat) so recall stays high even on a small
-- corpus — ivfflat needs many rows before its lists are useful and silently misses
-- results when nearly empty. HNSW also needs no retraining as the corpus grows.
create index if not exists idx_rag_chunks_embedding
    on rag_chunks using hnsw (embedding vector_cosine_ops);
