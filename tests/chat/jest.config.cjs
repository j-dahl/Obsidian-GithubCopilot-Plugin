module.exports = {
  rootDir: '../..',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/chat/**/*.test.ts'],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/tests/chat/obsidianMock.ts',
    '^security/(.*)$': '<rootDir>/tests/chat/securityStubs.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/chat/testSetup.ts'],
  roots: ['<rootDir>/tests/chat'],
};
