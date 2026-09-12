import { SetMetadata } from '@nestjs/common';

export const ALLOW_TEMP_PASSWORD_KEY = 'allowTempPassword';

/** Opt a route out of the temporary-password lockout in JwtAuthGuard — only the
 *  handful a locked-out session still needs: read itself, replace the password,
 *  log out. */
export const AllowTempPassword = () => SetMetadata(ALLOW_TEMP_PASSWORD_KEY, true);
