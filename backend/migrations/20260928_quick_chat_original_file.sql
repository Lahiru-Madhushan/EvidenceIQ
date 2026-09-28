-- Quick Chat: keep the uploaded file so the researcher can view the original beside the chat.
-- Must be applied before deploying the backend that reads these columns.
-- Safe to run more than once. Existing rows stay NULL and fall back to the extracted text.

alter table public.chat_sessions
  add column if not exists document_file bytea,
  add column if not exists document_mime text;
