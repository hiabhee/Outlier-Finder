import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { root } from './release-files.mjs';
const tests = fs.readdirSync(new URL('../tests/', import.meta.url)).filter(file => file.endsWith('.test.mjs')).sort();
execFileSync(process.execPath, ['--test', ...tests.map(file => 'tests/' + file)], { cwd: root, stdio: 'inherit' });
