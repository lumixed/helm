import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { config, runtime } from './config';
import { createApp } from './server';

// Maritime VMs ship an empty /etc/hosts, so "localhost" does not resolve (docs gotcha).
try {
  const hosts = fs.existsSync('/etc/hosts') ? fs.readFileSync('/etc/hosts', 'utf8') : '';
  if (!/\blocalhost\b/.test(hosts)) fs.appendFileSync('/etc/hosts', '127.0.0.1 localhost\n');
} catch {
  /* not root or read-only: fine outside Maritime */
}

const app = createApp();
serve({ fetch: app.fetch, hostname: '0.0.0.0', port: config.port }, (info) => {
  console.log(
    `[helm-agent] listening on 0.0.0.0:${info.port} (student=${runtime().studentId || '-'}, config=${runtime().source})`,
  );
});
