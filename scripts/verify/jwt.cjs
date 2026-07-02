/* Node-side JWT oracle using the SHIPPING TokenService (compiled).
 *   sign   <user_id>  -> prints an access token
 *   verify <token>    -> prints JSON {user_id, token_type, jti} or VERIFY_FAIL:<err>
 * Requires `pnpm --filter @lt/api build` first. */
require('reflect-metadata');
const path = require('node:path');
const { JwtService } = require('@nestjs/jwt');
const { TokenService } = require(
  path.join(__dirname, '..', '..', 'apps', 'api', 'dist', 'modules', 'auth', 'services', 'token.service.js'),
);

const SECRET = process.env.JWT_SECRET || 'shared-secret-for-cross-verify';
const cfg = {
  getOrThrow: () => SECRET,
  get: (k, d) => (k === 'JWT_ACCESS_TTL' ? 900 : k === 'JWT_REFRESH_TTL' ? 604800 : d),
};
const svc = new TokenService(new JwtService({}), cfg);

const [cmd, a1] = process.argv.slice(2);
if (cmd === 'sign') process.stdout.write(svc.signAccess(a1 || 'user-123'));
else if (cmd === 'verify') {
  try {
    const c = svc.verify(a1);
    process.stdout.write(JSON.stringify({ user_id: c.user_id, token_type: c.token_type, jti: c.jti }));
  } catch (e) {
    process.stdout.write('VERIFY_FAIL:' + e.message);
  }
} else {
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
