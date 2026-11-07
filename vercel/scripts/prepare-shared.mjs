import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.resolve(root, '..');
const shared = path.join(root, 'app/shared');
await rm(shared, { recursive: true, force: true });
await mkdir(shared, { recursive: true });
for (const name of ['desk.tsx', 'chart.tsx', 'deriv-markets.tsx', 'use-deriv.ts', 'globals.css']) {
  await cp(path.join(source, 'app', name), path.join(shared, name));
}
await rm(path.join(root, 'lib'), { recursive: true, force: true });
await mkdir(path.join(root, 'lib'), { recursive: true });
for (const name of ['contracts.ts', 'example.ts', 'deriv']) {
  await cp(path.join(source, 'lib', name), path.join(root, 'lib', name), { recursive: true });
}
await cp(path.join(source, 'public'), path.join(root, 'public'), { recursive: true });
console.log('Shared dashboard and Deriv scanner prepared for Next.js.');
