import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('frontend', 'dist', { recursive: true });
await mkdir('dist/shared', { recursive: true });
for (const name of ['route-config.js','route-engine.js','route-analysis.js','rational.js']) {
  await cp('shared/' + name, 'dist/shared/' + name);
}

console.log('Static frontend built in dist/');
