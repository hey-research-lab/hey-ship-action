import { defineConfig } from 'tsup';

/**
 * The action runs the committed `dist/index.js` directly (`runs.using: node24`), so every
 * dependency is bundled into that one file. No source maps, no minification and no banner keep
 * the output deterministic: CI rebuilds it and fails when the committed copy differs.
 */
export default defineConfig({
  entry: { index: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  noExternal: [/.*/],
});
