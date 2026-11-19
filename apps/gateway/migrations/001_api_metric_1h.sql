-- Hourly API aggregates: one row per tenant, service, direction, method, normalized route,
-- status code and hour. No request-level row exists anywhere.
CREATE TABLE api_metric_1h (
  tenant_id       text             NOT NULL,
  service_id      text             NOT NULL,
  direction       text             NOT NULL CHECK (direction IN ('server', 'client')),
  method          text             NOT NULL,
  route           text             NOT NULL,
  status_code     integer          NOT NULL,
  hour            timestamptz      NOT NULL,
  request_count   bigint           NOT NULL,
  duration_sum_ms double precision NOT NULL,
  -- Counts per fixed bucket: see BUCKET_BOUNDS_MS in src/histogram.ts, plus one overflow bucket.
  bucket_counts   bigint[]         NOT NULL,
  PRIMARY KEY (tenant_id, service_id, direction, method, route, status_code, hour)
);

CREATE INDEX api_metric_1h_hour_idx ON api_metric_1h (hour);
