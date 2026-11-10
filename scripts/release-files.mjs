import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtimeRoots = ['manifest.json', 'core', 'content', 'background', 'popup', 'options', 'assets', 'pages'];
export function runtimeEntries(base = root) {
  const entries = [];
  function walk(relative) {
    const absolute = path.join(base, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Runtime symlink is forbidden: ' + relative);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) {
        if (child === '.DS_Store') continue;
        if (child.startsWith('.')) throw new Error('Unexpected hidden runtime file: ' + relative + '/' + child);
        walk(relative + '/' + child);
      }
    } else {
      if (!/\.(js|json|css|html|png)$/.test(relative)) throw new Error('Unexpected runtime asset: ' + relative);
      entries.push({ name: relative, data: fs.readFileSync(absolute) });
    }
  }
  for (const entry of runtimeRoots) walk(entry);
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
