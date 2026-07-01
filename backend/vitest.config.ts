import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests connecting to local PostgreSQL need more time
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
