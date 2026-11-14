import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('frontend', 'dist', { recursive: true });

console.log('Static frontend built in dist/');