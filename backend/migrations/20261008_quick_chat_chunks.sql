-- Quick Chat: semantic search over long uploads.
-- Each passage of a long document is embedded once and stored here; questions are
-- then ranked against them by cosine distance (see backend/app/services/chunk_index.py).
--
-- Safe to run more than once. Safe to deploy the backend before it: until this table
-- exists, Quick Chat falls back to its lexical ranking alone.

create extension if not exists vector with schema extensions;

create table if not exists public.chat_chunks (
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  -- Position in document_text.chunk(document_text), which is how a ranking of chunks
  -- is mapped back onto the passages the prompt is built from.
  ordinal integer not null,
  content text not null,
  -- What produced the vector, e.g. "gemini-embedding-001@768". Vectors from different
  -- models or sizes do not compare, so a chat indexed under other settings is rebuilt.
  embedder text not null,
  -- Deliberately unsized, so changing EMBEDDING_DIMENSIONS needs no migration. Search
  -- is always within one session's few hundred rows, an exact scan, so the ANN index a
  -- fixed size would allow buys nothing here.
  embedding extensions.vector not null,
  primary key (session_id, ordinal)
);

-- Read and written only by the backend's own connection, which checks ownership on the
-- parent chat. RLS with no policies keeps the table closed to the browser's API keys.
alter table public.chat_chunks enable row level security;
