import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { AuthService } from './auth.service';

const user = {
  id: 'u1',
  email: 'asha@corp.com',
  name: 'Asha',
  password: 'pbkdf2_sha256$600000$salt$hash',
  isActive: true,
} as User;

function build(
  opts: { verifies?: boolean; outdated?: boolean; account?: User | null; lockedFor?: number } = {},
) {
  const update = jest.fn().mockResolvedValue(user);
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.account === undefined ? user : opts.account),
      update,
    },
  } as unknown as PrismaService;
  const passwords = {
    // Asynchronous, as PasswordService is: a missing await then stores a Promise.
    verify: jest.fn().mockResolvedValue(opts.verifies ?? true),
    verifyDecoy: jest.fn().mockResolvedValue(false),
    hash: jest.fn().mockResolvedValue('pbkdf2_sha256$600000$new$hash'),
    needsRehash: jest.fn().mockReturnValue(opts.outdated ?? false),
  };
  const tokens = { signAccess: jest.fn().mockReturnValue('a'), signRefresh: jest.fn().mockReturnValue({ token: 'r', jti: 'j' }) };
  const refreshStore = { store: jest.fn(), revokeAll: jest.fn() };
  const attempts = {
    lockedFor: jest.fn().mockResolvedValue(opts.lockedFor ?? 0),
    recordFailure: jest.fn(),
    clear: jest.fn(),
  };
  const resetStore = { consume: jest.fn().mockResolvedValue(true) };
  const userMapper = { toResponse: jest.fn().mockResolvedValue({ id: 'u1' }) };
  const mail = { sendPasswordChanged: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((_k: string, fallback: unknown) => fallback) };
  const audit = {
    loginSuccess: jest.fn(), loginFailure: jest.fn(), passwordChanged: jest.fn(), passwordResetCompleted: jest.fn(),
  };
  const svc = new AuthService(
    prisma, passwords as never, tokens as never, refreshStore as never, attempts as never,
    resetStore as never, userMapper as never, mail as never, config as never, audit as never, {} as never,
  );
  return { svc, update, mail, passwords, attempts, refreshStore };
}

describe('AuthService — telling the owner, keeping hashes current', () => {
  it('mails the owner when they change their password', async () => {
    const { svc, mail } = build();
    await svc.changePassword(user, { currentPassword: 'old', newPassword: 'New-Passw0rd!' } as never);
    expect(mail.sendPasswordChanged).toHaveBeenCalledWith('asha@corp.com', 'Asha', 'change');
  });

  it('and when a reset link changes it', async () => {
    const { svc, mail } = build();
    await svc.confirmPasswordReset({ uid: Buffer.from('u1').toString('base64url'), token: 't', newPassword: 'New-Passw0rd!' } as never);
    expect(mail.sendPasswordChanged).toHaveBeenCalledWith('asha@corp.com', 'Asha', 'reset');
  });

  it('says nothing when the current password was wrong and nothing changed', async () => {
    const { svc, mail } = build({ verifies: false });
    await svc.changePassword(user, { currentPassword: 'wrong', newPassword: 'New-Passw0rd!' } as never);
    expect(mail.sendPasswordChanged).not.toHaveBeenCalled();
  });

  it('replaces a hash made with fewer iterations at sign-in', async () => {
    const { svc, update } = build({ outdated: true });
    await svc.login('asha@corp.com', 'the-password');
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { password: 'pbkdf2_sha256$600000$new$hash' } });
  });

  it('and leaves a current one alone', async () => {
    const { svc, update } = build();
    await svc.login('asha@corp.com', 'the-password');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AuthService — sign-in does not say who has an account', () => {
  // An unknown address used to skip the hash entirely and answer at once.
  it('pays for a hash when the address has no account', async () => {
    const { svc, passwords, attempts } = build({ account: null });
    await expect(svc.login('nobody@corp.com', 'guess')).rejects.toMatchObject({ status: 400 });
    expect(passwords.verifyDecoy).toHaveBeenCalledWith('guess');
    expect(attempts.recordFailure).toHaveBeenCalled();
  });

  it('checks a real account against its own hash, not the decoy', async () => {
    const { svc, passwords } = build({ verifies: false });
    await expect(svc.login('asha@corp.com', 'guess')).rejects.toMatchObject({ status: 400 });
    expect(passwords.verify).toHaveBeenCalledWith('guess', user.password);
    expect(passwords.verifyDecoy).not.toHaveBeenCalled();
  });
});

describe('AuthService.changePassword — the current password is not a free guess', () => {
  const change = { currentPassword: 'Temp-Passw0rd!', newPassword: 'New-Passw0rd!' };

  it('counts a wrong current password against the account', async () => {
    const { svc, attempts } = build({ verifies: false });
    const result = await svc.changePassword(user, change as never);
    expect(result).toEqual({ softError: { status: 400, message: 'Current password is incorrect' } });
    expect(attempts.recordFailure).toHaveBeenCalledWith('asha@corp.com', 'change-password');
    // Its own count only: guessing at the sign-in page must not lock the owner out of this.
    expect(attempts.lockedFor).toHaveBeenCalledWith('asha@corp.com', 'change-password', {
      accountWide: false,
    });
  });

  it('stops answering once too many were wrong — even for the right one', async () => {
    const { svc, passwords, update } = build({ lockedFor: 120 });
    await expect(svc.changePassword(user, change as never)).rejects.toMatchObject({ status: 429 });
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // Only the browser refused this, so a temporary-password account could clear
  // hasTempPassword through the API and keep the mailed password.
  it('refuses a new password that is the current one', async () => {
    const { svc, update, refreshStore } = build();
    const result = await svc.changePassword(user, {
      currentPassword: 'Temp-Passw0rd!',
      newPassword: 'Temp-Passw0rd!',
    } as never);
    expect(result).toMatchObject({ softError: { status: 400 } });
    expect(update).not.toHaveBeenCalled();
    expect(refreshStore.revokeAll).not.toHaveBeenCalled();
  });

  it('still changes a password to a different one', async () => {
    const { svc, update } = build();
    await expect(svc.changePassword(user, change as never)).resolves.toMatchObject({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { password: 'pbkdf2_sha256$600000$new$hash', hasTempPassword: false },
    });
  });
});
