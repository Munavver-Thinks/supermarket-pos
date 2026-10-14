import { describe, expect, it } from "vitest";

import { AttemptThrottle, throttleKey } from "./attemptThrottle.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const OPTIONS = { maxFailures: 5, windowMs: 5 * 60_000, lockoutMs: 60_000 };

describe("AttemptThrottle", () => {
  it("allows attempts until the fifth failure, then locks the key for a minute", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 4; i++) {
      throttle.recordFailure("k");
      expect(throttle.check("k").allowed).toBe(true);
    }
    throttle.recordFailure("k");
    const check = throttle.check("k");
    expect(check.allowed).toBe(false);
    if (!check.allowed) expect(check.retryAfterMs).toBe(60_000);

    c.advance(59_999);
    expect(throttle.check("k").allowed).toBe(false);
    c.advance(1);
    expect(throttle.check("k").allowed).toBe(true);
  });

  it("starts counting afresh after a lockout ends", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 5; i++) throttle.recordFailure("k");
    c.advance(60_000);
    expect(throttle.check("k").allowed).toBe(true);
    throttle.recordFailure("k");
    expect(throttle.check("k").allowed).toBe(true);
  });

  it("forgets failures older than the window", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 4; i++) throttle.recordFailure("k");
    c.advance(5 * 60_000);
    throttle.recordFailure("k");
    expect(throttle.check("k").allowed).toBe(true);
  });

  it("clears a key on success", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 4; i++) throttle.recordFailure("k");
    throttle.recordSuccess("k");
    throttle.recordFailure("k");
    expect(throttle.check("k").allowed).toBe(true);
  });

  it("keeps keys apart", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 5; i++) throttle.recordFailure("a");
    expect(throttle.check("a").allowed).toBe(false);
    expect(throttle.check("b").allowed).toBe(true);
  });

  it("sweeps stale keys once many are tracked, without dropping live lockouts", () => {
    const c = clock();
    const throttle = new AttemptThrottle(OPTIONS, c.now);
    for (let i = 0; i < 5; i++) throttle.recordFailure("locked");
    for (let i = 0; i < 600; i++) {
      throttle.recordFailure(`user-${i}`);
      if (i === 300) c.advance(5 * 60_000 - 1000);
    }
    expect(throttle.check("locked").allowed).toBe(true); // its minute has long passed
    for (let i = 0; i < 5; i++) throttle.recordFailure("locked-now");
    for (let i = 0; i < 600; i++) throttle.recordFailure(`other-${i}`);
    expect(throttle.check("locked-now").allowed).toBe(false);
  });
});

describe("throttleKey", () => {
  it("combines store and a case-folded username", () => {
    expect(throttleKey("s1", " Admin ")).toBe("s1|admin");
    expect(throttleKey("s1", "admin")).not.toBe(throttleKey("s2", "admin"));
  });
});
