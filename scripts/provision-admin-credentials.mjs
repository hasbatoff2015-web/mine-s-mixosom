#!/usr/bin/env node
/**
 * Print two admin tokens and the matching server-side hashes.
 * Does not write a file, does not talk to the network, and does not read the world.
 */
import { createHash, randomBytes } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ids = process.argv.slice(2);
if (ids.length !== 2 || ids[0] === ids[1] || ids.some((id) => !ID.test(id))) {
  console.error('Usage: node scripts/provision-admin-credentials.mjs <admin-id-1> <admin-id-2>');
  console.error('Generates two random tokens. Does not write a file.');
  process.exit(1);
}

const shown = [];
const hashes = [];
for (const id of ids) {
  const secret = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
  shown.push(`${id}\n${secret}`);
  hashes.push(`${id}:${digest}`);
}

console.log('Administrator tokens. Give each token to one person.');
console.log('Do not commit them, do not put them in a world save, and do not paste them into chat logs.');
console.log('');
console.log(shown.join('\n\n'));
console.log('');
console.log('Server environment. These are hashes, not the tokens:');
console.log('');
console.log(`FC_ADMIN_IDS=${ids.join(',')}`);
console.log(`FC_ADMIN_AUTH_HASHES=${hashes.join(',')}`);
console.log('FC_ADMIN_PORT=8765');
console.log('');
console.log('The listener binds 127.0.0.1 only. Do not publish that port.');
