import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Each test file boots its own in-memory PGlite and runs every migration; under parallel load
  // the first boot can take longer than vitest's 5 s default.
  test: { environment: 'node', testTimeout: 20_000, hookTimeout: 20_000 },
});
