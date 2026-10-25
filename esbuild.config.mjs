import { context } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

const build = await context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  minify: false,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/common', '@lezer/lr', '@lezer/highlight', ...builtinModules],
  banner: { js: '/* SixDots — MIT. Source: https://github.com/saltcoffee/six-dots\n' + readFileSync('LICENSE', 'utf8') + '\nBundled @lezer/markdown:\n' + readFileSync('node_modules/@lezer/markdown/LICENSE', 'utf8') + '\n*/' },
});
if (process.argv.includes('--watch')) await build.watch();
else { await build.rebuild(); await build.dispose(); }
