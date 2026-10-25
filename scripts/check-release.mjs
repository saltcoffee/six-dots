import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { releaseNotes } from './release-notes.mjs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
const tag = process.env.RELEASE_TAG;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Version must be x.y.z');
assert(!tag || tag === manifest.version, 'The tag must match manifest.version exactly, without v');
assert(pkg.version === manifest.version, 'package.json and manifest versions differ');
assert(manifest.name === 'SixDots' && manifest.id === 'six-dots', 'Unexpected plugin identity');
assert(versions[manifest.version] === manifest.minAppVersion, 'Missing minimum app mapping');
assert(manifest.description.length <= 250 && manifest.description.endsWith('.'), 'Invalid marketplace description');
for (const file of ['main.js', 'styles.css', 'LICENSE', 'README.md', 'README.zh-CN.md', 'THIRD_PARTY_NOTICES.md']) assert(existsSync(file) && readFileSync(file).length > 0, `Missing ${file}`);
const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), manifest.version);
assert(!/TODO|TBD|placeholder/i.test(notes), 'Release notes contain unfinished text');
for (const file of ['README.md', 'README.zh-CN.md']) {
  assert(!/\]\(docs\//.test(readFileSync(file, 'utf8')), 'User README links to ignored docs');
}
function inspect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) inspect(file);
    else if (file.endsWith('.ts')) assert(readFileSync(file, 'utf8').split('\n').length <= 600, `${file} exceeds 600 lines`);
  }
}
inspect('src');
process.stdout.write(`Release ${manifest.version} validated${tag ? ` for tag ${tag}` : ''}.\n`);
