// Jest global setup — provide required env vars for tests
// These are dummy values; no real operator wallet is needed for unit tests.
process.env.OPERATOR_WALLET = '0x' + '1'.repeat(40);
process.env.NODE_ENV = 'test';

// Handle BigInt serialization for Jest
BigInt.prototype.toJSON = function() {
  return this.toString();
};
