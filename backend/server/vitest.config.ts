import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      // Also include top level files
      'src/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    exclude: ['build/**/*'],
  },
  resolve: {
    alias: {
      '@fetchr/schema': path.resolve(__dirname, './src/proto'),
    },
  },
});
