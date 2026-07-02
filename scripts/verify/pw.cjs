/* Node-side password oracle using the SHIPPING PasswordService (compiled).
 *   verify <hash> <password>  -> prints true/false
 *   hash   <password>         -> prints a Node-produced Django-format hash
 * Requires `pnpm --filter @lt/api build` first. */
require('reflect-metadata');
const path = require('node:path');
const { PasswordService } = require(
  path.join(__dirname, '..', '..', 'apps', 'api', 'dist', 'modules', 'auth', 'services', 'password.service.js'),
);

const svc = new PasswordService();
const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'verify') process.stdout.write(String(svc.verify(a2, a1)));
else if (cmd === 'hash') process.stdout.write(svc.hash(a1));
else {
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
