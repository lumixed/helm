// Bundles the agent into one file and writes a self-contained deploy folder:
//   agent/.deploy/{Dockerfile, server.mjs}
// Upload that folder to Maritime with `maritime agents upload-source agent/.deploy`.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const deploy = path.join(root, '.deploy');

await build({
  entryPoints: [path.join(root, 'src/start.ts')],
  outfile: path.join(dist, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

fs.rmSync(deploy, { recursive: true, force: true });
fs.mkdirSync(deploy, { recursive: true });
fs.copyFileSync(path.join(dist, 'server.mjs'), path.join(deploy, 'server.mjs'));
fs.copyFileSync(path.join(root, 'Dockerfile.runtime'), path.join(deploy, 'Dockerfile'));
console.log(
  `bundled -> ${path.relative(process.cwd(), deploy)}/ (${fs.statSync(path.join(deploy, 'server.mjs')).size} bytes)`,
);
