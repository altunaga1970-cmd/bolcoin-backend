module.exports = {
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/bolcoin-frontend/', '/contracts/', '/backend/'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/__tests__/setup.js'],
  // Handle BigInt serialization for Jest
  testRunner: 'jest-circus/runner',
};
