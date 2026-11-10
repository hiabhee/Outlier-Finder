import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { root, runtimeEntries } from './release-files.mjs';

export function validate() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const entries = runtimeEntries();
  const files = new Map(entries.map(entry => [entry.name, entry.data]));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version, 'Package and manifest versions differ');
  assert.equal(lock.version, pkg.version, 'Lockfile version differs');
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.packages['node_modules/jsdom'].version, pkg.devDependencies.jsdom);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.name.length <= 75 && manifest.description.length <= 132);
  assert.deepEqual(manifest.permissions, ['storage'], 'Review any permission change');
  assert.deepEqual(new Set(manifest.host_permissions), new Set([
    'https://www.youtube.com/*', 'https://x.com/*', 'https://www.x.com/*',
    'https://twitter.com/*', 'https://www.twitter.com/*',
    'https://www.instagram.com/*', 'https://instagram.com/*'
  ]));
  assert.equal(manifest.author, 'hiabhee');
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'; base-uri 'none';");
  function reference(file, from = 'manifest.json') {
    assert.ok(typeof file === 'string' && !/^(?:https?:|data:|javascript:)/i.test(file), 'Executable resource must be local: ' + file);
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), file.replace(/^\//, '')));
    assert.ok(files.has(relative), from + ' references missing asset ' + relative);
  }
  for (const block of manifest.content_scripts) {
    for (const file of [...block.js, ...(block.css || [])]) reference(file);
    for (const match of block.matches) assert.ok(manifest.host_permissions.includes(match));
    assert.ok(['document_start', 'document_idle'].includes(block.run_at));
  }
  reference(manifest.background.service_worker);
  reference(manifest.action.default_popup);
  reference(manifest.options_page);
  const worker = files.get(manifest.background.service_worker).toString();
  const imports = worker.match(/importScripts\(([\s\S]*?)\);/);
  assert.ok(imports, 'Missing service worker imports');
  for (const match of imports[1].matchAll(/"([^"]+)"/g)) reference(match[1]);
  for (const [size, file] of Object.entries(manifest.icons)) {
    reference(file);
    const png = files.get(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  for (const file of Object.values(manifest.action.default_icon)) reference(file);
  for (const entry of entries) {
    const text = entry.data.toString();
    if (entry.name.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', path.join(root, entry.name)], { stdio: 'pipe' });
      assert.ok(!/\b(?:eval|new\s+Function)\s*\(/.test(text), 'Dynamic executable code: ' + entry.name);
    }
    if (!entry.name.endsWith('.html')) continue;
    assert.match(text, /<html\b[^>]*\blang=/i, 'Page language missing: ' + entry.name);
    assert.ok(!/\son[a-z]+\s*=/i.test(text), 'Inline event handler: ' + entry.name);
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = match[1].match(/\bsrc="([^"]+)"/);
      assert.ok(src && !match[2].trim(), 'Inline script: ' + entry.name);
      reference(src[1], entry.name);
    }
    for (const match of text.matchAll(/<(?:link|img)\b[^>]*(?:href|src)="([^"]+)"/gi)) reference(match[1], entry.name);
    for (const match of text.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
      if (!/^(?:[a-z]+:|#)/i.test(match[1])) reference(match[1].split('#')[0], entry.name);
    }
  }
  assert.ok(files.get('content/xTimelineReader.js').toString().includes('"' + manifest.version + '"'), 'Reader version differs');
  console.log('Validated v' + manifest.version + ': ' + files.size + ' runtime files, references, icons, syntax and permission boundaries.');
  return { manifest, entries };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) validate();
