-- OA Smart Assistant v13 | PostgreSQL 14+
-- Production source of truth. V22 explicitly bootstraps public knowledge only.
CREATE TABLE IF NOT EXISTS oa_settings (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oa_faq_entries (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  question text NOT NULL DEFAULT '',
  answer text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'uk',
  enabled boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oa_faq_entries_language_idx ON oa_faq_entries (language, enabled);
CREATE TABLE IF NOT EXISTS oa_chat_entries (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  question text NOT NULL DEFAULT '',
  answer text NOT NULL DEFAULT '',
  created_at text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oa_chat_entries_created_idx ON oa_chat_entries (created_at);
CREATE TABLE IF NOT EXISTS oa_feedback_entries (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  response_id text,
  status text NOT NULL DEFAULT 'pending',
  value text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oa_feedback_entries_status_idx ON oa_feedback_entries (status);
CREATE TABLE IF NOT EXISTS oa_reports (
  id text PRIMARY KEY,
  report_type text NOT NULL,
  position integer NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oa_reports_type_idx ON oa_reports (report_type, position);
CREATE TABLE IF NOT EXISTS oa_knowledge_chunks (
  id bigint PRIMARY KEY,
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  chunk text NOT NULL DEFAULT '',
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS oa_knowledge_chunks_url_idx ON oa_knowledge_chunks (url);
CREATE TABLE IF NOT EXISTS oa_knowledge_artifacts (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
