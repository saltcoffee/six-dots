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
  // CodeMirror must share Obsidian's runtime. Our parser's trees stay private,
  // so bundle its Lezer runtime instead of requiring a recent host version.
  external: ['obsidian', 'electron', '@codemirror/*', ...builtinModules],
  banner: { js: '/* SixDots — MIT. Source: https://github.com/saltcoffee/six-dots\n' + readFileSync('LICENSE', 'utf8')
    + ['markdown', 'common', 'highlight'].map(name => `\nBundled @lezer/${name}:\n${readFileSync(`node_modules/@lezer/${name}/LICENSE`, 'utf8')}`).join('') + '\n*/' },
});
if (process.argv.includes('--watch')) await build.watch();
else { await build.rebuild(); await build.dispose(); }
