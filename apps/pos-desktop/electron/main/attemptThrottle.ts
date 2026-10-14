/**
 * Slows down password guessing at the counter, for both sign-in and manager approval. A
 * manager's password typed into the approval box is the same password that signs them in,
 * so both paths share one throttle: guessing through one locks the other too.
 *
 * In memory only, so it resets when the app restarts. That is enough to stop someone
 * standing at the till trying passwords; it is not protection against an attacker with
 * access to the database file, who has no need to guess.
 *
 * Pure (no electron import) so it can be unit-tested with an injected clock.
 */

export interface AttemptThrottleOptions {
  /** Failures within `windowMs` that trigger a lockout. */
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

export const DEFAULT_THROTTLE_OPTIONS: AttemptThrottleOptions = {
  maxFailures: 5,
  windowMs: 5 * 60_000,
  lockoutMs: 60_000,
};

export const TOO_MANY_ATTEMPTS_MESSAGE = "Too many attempts — wait a minute.";

/** Above this many tracked keys, stale entries are swept so a flood of usernames can't grow memory. */
const SWEEP_THRESHOLD = 500;

interface KeyState {
  failures: number[];
  lockedUntil: number | null;
}

export type ThrottleCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

export class AttemptThrottle {
  private readonly entries = new Map<string, KeyState>();

  constructor(
    private readonly options: AttemptThrottleOptions = DEFAULT_THROTTLE_OPTIONS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Whether an attempt for this key may be checked at all. Asked before the password is
   * compared: during a lockout even the right password is refused, or the lockout would
   * tell a guesser when they had hit it.
   */
  check(key: string): ThrottleCheck {
    const state = this.entries.get(key);
    if (!state?.lockedUntil) return { allowed: true };
    const remaining = state.lockedUntil - this.now();
    if (remaining > 0) return { allowed: false, retryAfterMs: remaining };
    // The lockout has run out: start counting afresh.
    this.entries.delete(key);
    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = this.now();
    const state = this.entries.get(key) ?? { failures: [], lockedUntil: null };
    state.failures = state.failures.filter((t) => now - t < this.options.windowMs);
    state.failures.push(now);
    if (state.failures.length >= this.options.maxFailures) {
      state.lockedUntil = now + this.options.lockoutMs;
      state.failures = [];
    }
    this.entries.set(key, state);
    if (this.entries.size > SWEEP_THRESHOLD) this.sweep(now);
  }

  /** A correct password clears that key's history. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, state] of this.entries) {
      const lockExpired = state.lockedUntil === null || state.lockedUntil <= now;
      const failuresExpired = state.failures.every((t) => now - t >= this.options.windowMs);
      if (lockExpired && failuresExpired) this.entries.delete(key);
    }
  }
}

/** Store + the username attempted. Usernames are lowercase by rule, so case is folded to match. */
export function throttleKey(storeId: string, username: string): string {
  return `${storeId}|${username.trim().toLowerCase()}`;
}

/** The one instance shared by login and manager approval. */
export const credentialThrottle = new AttemptThrottle();
