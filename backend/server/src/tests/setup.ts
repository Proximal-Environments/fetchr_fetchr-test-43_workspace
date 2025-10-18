import { beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { config } from 'dotenv';

// Load environment variables for testing
beforeAll(() => {
  config({ path: '.env' });
});

// Add any global test setup here
beforeEach(() => {
  // Reset any mocks or test state before each test
});

afterEach(() => {
  // Clean up any test artifacts
});

afterAll(() => {
  // Global cleanup after all tests
});
