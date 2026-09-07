import path from 'node:path';

import { defineConfig } from 'vitest/config';

const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // `server-only` throws when imported outside a React Server Component bundle;
      // its own empty stub is exactly what Next resolves it to on the server.
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Every test runs against a throwaway in-memory database and never touches the
    // network — `fetchExternal` is stubbed with `setFetchImpl`.
    env: { ITSTINGS_DB_PATH: ':memory:' },
  },
});
