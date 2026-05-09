// Shared rate-limit error type. Lives in its own module so nba-odds,
// sport_scan, analyzer_queue, and process-analyzer-queue can all import it
// without pulling in queue-specific code.

export class RateLimitError extends Error {
  retry_after_ms: number;
  constructor(retry_after_ms: number, message?: string) {
    super(message ?? `rate limited; retry in ${retry_after_ms}ms`);
    this.name = "RateLimitError";
    this.retry_after_ms = retry_after_ms;
  }
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "RateLimitError"
  );
}
