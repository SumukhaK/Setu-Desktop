/** Monotonic clock in milliseconds; injectable so reducers are testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => performance.now() };
