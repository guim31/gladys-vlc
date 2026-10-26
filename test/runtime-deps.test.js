// The image is built with `npm ci --omit=dev`: every package the code imports
// must be a runtime dependency, or the container does not start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) {
      return sources(url);
    }
    return entry.name.endsWith('.js') ? [url] : [];
  });
}

test('every package imported by the code is a runtime dependency', () => {
  const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
  const imported = new Set();
  for (const file of [new URL('index.js', root), ...sources(new URL('src/', root))]) {
    const code = readFileSync(file, 'utf8');
    for (const [, spec] of code.matchAll(
      /(?<![.\w])(?:from|import)\s*\(?\s*['"]([^'"./][^'"]*)['"]/g,
    )) {
      if (spec.startsWith('node:') || builtinModules.includes(spec)) {
        continue;
      }
      const name = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      imported.add(name);
    }
  }
  assert.ok(imported.has('jpeg-js'));
  for (const name of imported) {
    assert.ok(runtime.has(name), `${name} is imported by the code but not in dependencies`);
  }
});
