import axios from "axios";
import { NonRetryableError, describeError } from "../../utils/safeError";

const RETRYABLE_STATUS = new Set([429, 503, 529]);
// Out of credits rather than rate limited: waiting will not help.
const PERMANENT_CODES = new Set(["insufficient_quota", "credit_balance_exhausted"]);
const MAX_DELAY_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitStatus = (error: unknown) =>
  axios.isAxiosError(error) &&
  !!error.response &&
  RETRYABLE_STATUS.has(error.response.status);

const isOutOfCredits = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  const body = error.response?.data as
    | { error?: { code?: unknown; type?: unknown } }
    | undefined;
  return [body?.error?.code, body?.error?.type].some(
    (value) => typeof value === "string" && PERMANENT_CODES.has(value),
  );
};

/** True for rate-limit/overload responses that are worth waiting out. */
export const isRetryableLLMError = (error: unknown): boolean =>
  isRateLimitStatus(error) && !isOutOfCredits(error);

/**
 * How long the provider asked us to wait (Retry-After header, or Gemini's
 * RetryInfo "37s"), uncapped; undefined when it gave no hint.
 */
const hintedDelayMs = (error: unknown): number | undefined => {
  if (!axios.isAxiosError(error) || !error.response) return undefined;
  const header = Number(error.response.headers?.["retry-after"]);
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const details = (error.response.data as { error?: { details?: Array<{ retryDelay?: unknown }> } })
    ?.error?.details;
  const hinted = details?.find((detail) => typeof detail.retryDelay === "string")?.retryDelay as
    | string
    | undefined;
  const seconds = hinted ? Number.parseFloat(hinted) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 1000 : undefined;
};

/** The provider's hint, else exponential backoff; capped at one minute. */
export const retryDelayMs = (error: unknown, attempt: number): number =>
  Math.min(hintedDelayMs(error) ?? 10_000 * 2 ** attempt, MAX_DELAY_MS);

/**
 * Runs `call`, retrying rate-limit/overload failures up to `retries` times.
 * Exhausted credits or a quota that resets later than the cap (e.g. a daily
 * free-tier limit) fail immediately as NonRetryableError, so neither this
 * loop nor the queue spends time on retries that cannot succeed.
 */
export const withLLMRetry = async <T>(
  call: () => Promise<T>,
  { retries, wait = sleep }: { retries: number; wait?: (ms: number) => Promise<unknown> },
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!isRateLimitStatus(error)) throw error;
      if (isOutOfCredits(error))
        throw new NonRetryableError(`LLM account has no credits left: ${describeError(error)}`);
      const hinted = hintedDelayMs(error);
      if (hinted !== undefined && hinted > MAX_DELAY_MS)
        throw new NonRetryableError(
          `LLM quota exhausted; provider asks to retry in ${Math.round(hinted / 1000)}s: ${describeError(error)}`,
        );
      if (attempt >= retries) throw error;
      await wait(retryDelayMs(error, attempt));
    }
  }
};
