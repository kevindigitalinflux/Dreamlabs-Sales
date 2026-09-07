CREATE TABLE rate_limit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_log_key_time ON rate_limit_log(rate_key, created_at);
-- No RLS policy needed — this table is never queried by anon/authenticated
-- roles directly, only by service-role edge functions.
ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;
