import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { calculateNextRetryDelay, isValidCron, calculateNextRunAt } from '../src/utils/retry';

describe('Retry Strategy - calculateNextRetryDelay', () => {
  it('FIXED: always returns the base delay (with jitter)', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = calculateNextRetryDelay('FIXED', attempt, 1000, 60000, 2);
      expect(delay).toBeGreaterThan(900); // within 10% jitter
      expect(delay).toBeLessThan(1100);
    }
  });

  it('LINEAR: delay increases linearly with attempt', () => {
    const d1 = calculateNextRetryDelay('LINEAR', 1, 1000, 60000, 2);
    const d2 = calculateNextRetryDelay('LINEAR', 2, 1000, 60000, 2);
    const d3 = calculateNextRetryDelay('LINEAR', 3, 1000, 60000, 2);
    // d2 ~= 2*d1 and d3 ~= 3*d1 (within jitter)
    expect(d2 / d1).toBeGreaterThan(1.5);
    expect(d3 / d1).toBeGreaterThan(2);
  });

  it('EXPONENTIAL: delay doubles each attempt', () => {
    const d1 = calculateNextRetryDelay('EXPONENTIAL', 1, 1000, 60000, 2);
    const d2 = calculateNextRetryDelay('EXPONENTIAL', 2, 1000, 60000, 2);
    const d3 = calculateNextRetryDelay('EXPONENTIAL', 3, 1000, 60000, 2);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it('caps at maxDelayMs', () => {
    const delay = calculateNextRetryDelay('EXPONENTIAL', 100, 1000, 5000, 2);
    expect(delay).toBeLessThanOrEqual(5500); // max + jitter
  });
});

describe('Cron Validation', () => {
  it('accepts valid cron expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true);
    expect(isValidCron('0 * * * *')).toBe(true);
    expect(isValidCron('0 9 * * MON-FRI')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
  });

  it('rejects invalid cron expressions', () => {
    expect(isValidCron('invalid cron string')).toBe(false);
    expect(isValidCron('60 * * * *')).toBe(false);
    expect(isValidCron('not-a-cron')).toBe(false);
  });

  it('calculates next run time correctly', () => {
    const next = calculateNextRunAt('* * * * *');
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Should be within the next 2 minutes
    expect(next.getTime()).toBeLessThan(Date.now() + 120000);
  });
});
