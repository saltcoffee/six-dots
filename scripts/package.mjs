import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import './check-release.mjs';

const { version, id } = JSON.parse(readFileSync('manifest.json', 'utf8'));
mkdirSync(`dist/${id}`, { recursive: true });
const files = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
for (const file of files) {
  copyFileSync(file, `dist/${file}`);
  copyFileSync(file, `dist/${id}/${file}`);
}
// Explicit paths only: packaging never deletes or recursively cleans a directory.
const output = `${id}-${version}.zip`;
execFileSync('zip', ['-q', '-X', output, ...files.map(file => `${id}/${file}`)], { cwd: 'dist' });
process.stdout.write(`Created dist/${output}\n`);
