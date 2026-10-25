import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function releaseNotes(changelog, version) {
  const escaped = version.replaceAll('.', '\\.');
  const match = new RegExp(`^## (?:\\[${escaped}\\]|${escaped})(?:[ \\t]+[^\\n]*)?\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog);
  const body = match?.[1]?.trim();
  if (!body) throw new Error(`Missing changelog content for ${version}`);
  return body + '\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const body = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), manifest.version);
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/release-notes.md', body);
  process.stdout.write(body);
}
