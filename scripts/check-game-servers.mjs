/**
 * Check the three production game servers via GET /status.
 * Does not start them. Exits 1 if any server is down or reports the wrong world.
 *
 *   npm run status:servers
 *   FC_STATUS_HOST=127.0.0.1 node scripts/check-game-servers.mjs
 */
const SERVERS = [
  { mode: 'anarchy', world: 'anarchy', port: 2567 },
  { mode: 'survival', world: 'survival', port: 2568 },
  { mode: 'peaceful', world: 'peaceful', port: 2569 },
];

const host = process.env.FC_STATUS_HOST || '127.0.0.1';
let failed = 0;

for (const server of SERVERS) {
  const url = `http://${host}:${server.port}/status`;
  try {
    const response = await fetch(url);
    const body = await response.json();
    const ok = response.status === 200
      && body.ready === true
      && body.mode === server.mode
      && body.world === server.world;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok' : 'FAIL'} ${url} http=${response.status} ${JSON.stringify(body)}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${url} ${message}`);
  }
}

if (failed > 0) {
  console.error(`[status:servers] ${failed} of ${SERVERS.length} failed`);
  process.exit(1);
}
console.log('[status:servers] anarchy, survival, peaceful ready');
