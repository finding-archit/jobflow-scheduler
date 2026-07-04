import { RetryStrategy } from '@prisma/client';

export function calculateNextRetryDelay(
  strategy: RetryStrategy,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  multiplier: number = 2.0
): number {
  let delay: number;

  switch (strategy) {
    case 'FIXED':
      delay = baseDelayMs;
      break;
    case 'LINEAR':
      delay = baseDelayMs * attempt;
      break;
    case 'EXPONENTIAL':
      delay = baseDelayMs * Math.pow(multiplier, attempt - 1);
      break;
    default:
      delay = baseDelayMs;
  }

  // Add jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  delay = Math.min(delay + jitter, maxDelayMs);

  return Math.round(delay);
}

export function calculateNextRunAt(cronExpr: string): Date {
  const parser = require('cron-parser');
  try {
    const interval = parser.parseExpression(cronExpr, { currentDate: new Date() });
    return interval.next().toDate();
  } catch {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }
}

export function isValidCron(expr: string): boolean {
  const parser = require('cron-parser');
  try {
    parser.parseExpression(expr);
    return true;
  } catch {
    return false;
  }
}
