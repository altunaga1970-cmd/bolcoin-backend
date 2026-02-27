/**
 * Integer-cents arithmetic helpers for monetary operations.
 * USDT uses 2 decimal places (1 cent = 0.01 USDT).
 *
 * Why: JavaScript floating point cannot represent 0.1 + 0.2 exactly.
 * Working in integer cents avoids accumulated rounding errors in balances.
 *
 * Usage:
 *   const newBalance = fromCents(toCents(user.balance) - toCents(withdrawal.amount));
 */

/** Convert USDT amount (string or number) to integer cents. */
function toCents(x) {
  return Math.round(Number(x) * 100);
}

/** Convert integer cents back to USDT (number with at most 2 decimal places). */
function fromCents(cents) {
  return cents / 100;
}

module.exports = { toCents, fromCents };
