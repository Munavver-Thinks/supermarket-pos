/**
 * Whether a crashed billing screen should be reloaded automatically. One crash mid-shift
 * should cost the cashier a second, not a click — but a screen that crashes again every time
 * it loads would reload forever, so after a few crashes in a short time the app stops and
 * asks instead.
 */

export interface CrashLoopOptions {
  /** Automatic reloads allowed within the window. */
  max: number;
  windowMs: number;
}

export const DEFAULT_CRASH_LOOP_OPTIONS: CrashLoopOptions = { max: 3, windowMs: 300_000 };

/**
 * `recentCrashTimes` are the earlier crashes (epoch ms), not counting the one that just
 * happened. With the defaults, the first three crashes in five minutes reload; the fourth asks.
 */
export function shouldAutoReload(
  recentCrashTimes: number[],
  now: number,
  options: CrashLoopOptions = DEFAULT_CRASH_LOOP_OPTIONS,
): boolean {
  const inWindow = recentCrashTimes.filter((t) => t <= now && now - t < options.windowMs).length;
  return inWindow < options.max;
}
