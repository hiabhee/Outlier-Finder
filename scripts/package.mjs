import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, runtimeRoots } from './release-files.mjs';
import { validate } from './validate.mjs';
import { zip } from './zip.mjs';

const { manifest, entries } = validate();
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const staging = fs.mkdtempSync(path.join(dist, '.release-'));
try {
  const archive = zip(entries);
  const filename = 'outlier-finder-' + manifest.version + '.zip';
  const hash = createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(path.join(staging, filename), archive);
  fs.writeFileSync(path.join(staging, filename + '.sha256'), hash + '  ' + filename + '\n');
  const output = path.join(staging, 'unpacked');
  for (const { name, data } of entries) {
    fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
    fs.writeFileSync(path.join(output, name), data);
  }
  // Replace generated directories completely so removed source files disappear.
  for (const directory of ['unpacked', 'site']) fs.rmSync(path.join(dist, directory), { recursive: true, force: true });
  fs.renameSync(output, path.join(dist, 'unpacked'));
  fs.cpSync(path.join(dist, 'unpacked', 'pages'), path.join(dist, 'site'), { recursive: true });
  for (const name of [filename, filename + '.sha256']) fs.renameSync(path.join(staging, name), path.join(dist, name));
  // Preserve the path used by the existing local Chrome installation.
  const installed = path.join(root, 'outlier-finder');
  if (fs.existsSync(installed)) {
    for (const name of runtimeRoots) fs.rmSync(path.join(installed, name), { recursive: true, force: true });
    for (const name of runtimeRoots) fs.cpSync(path.join(dist, 'unpacked', name), path.join(installed, name), { recursive: true });
  }
  fs.writeFileSync(path.join(dist, 'release.json'), JSON.stringify({ version: manifest.version, archive: filename, sha256: hash, files: entries.map(({ name }) => name), validated: true }, null, 2) + '\n');
  console.log('Built dist/' + filename + ', checksum, dist/unpacked and dist/site.');
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
