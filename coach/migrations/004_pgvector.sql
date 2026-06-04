-- 004_pgvector.sql — vector store for the RAG corpus (Postgres + pgvector).
create extension if not exists vector;

create table if not exists rag_chunks (
    chunk_id   text primary key,
    doc_id     text not null,
    idx        int  not null,
    text       text not null,
    provenance jsonb not null,
    embedding  vector(1536) not null   -- MUST match your embeddings model's dimension
);

-- Cosine-distance ANN index; tune `lists` to corpus size.
create index if not exists idx_rag_chunks_embedding
    on rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
