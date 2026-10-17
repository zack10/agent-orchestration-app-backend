/**
 * Raised when a provider returns no usable output: truncated at the token
 * limit, blocked by a safety filter, or empty. Partial output must never be
 * parsed as if it were complete.
 */
export class LLMOutputError extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider} returned unusable output: ${reason}`);
    this.name = "LLMOutputError";
    Object.setPrototypeOf(this, LLMOutputError.prototype);
  }
}
