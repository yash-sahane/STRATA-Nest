import { createHmac } from 'node:crypto';
import { normalizeCommits, verifyGithubSignature, verifyGitlabToken } from './webhook.util';

describe('verifyGithubSignature', () => {
  const secret = 'whsec_123';
  const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
  const good = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a valid signature over the raw body', () => {
    expect(verifyGithubSignature(body, secret, good)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyGithubSignature(Buffer.from('other'), secret, good)).toBe(false);
  });
  it('rejects a wrong secret', () => {
    expect(verifyGithubSignature(body, 'nope', good)).toBe(false);
  });
  it('rejects when secret or header is missing', () => {
    expect(verifyGithubSignature(body, '', good)).toBe(false);
    expect(verifyGithubSignature(body, secret, undefined)).toBe(false);
  });
});

describe('verifyGitlabToken', () => {
  it('accepts an exact token match, rejects otherwise', () => {
    expect(verifyGitlabToken('tok', 'tok')).toBe(true);
    expect(verifyGitlabToken('tok', 'nope')).toBe(false);
    expect(verifyGitlabToken('', '')).toBe(false);
  });
});

describe('normalizeCommits', () => {
  it('maps GitHub-style commits and drops entries without a sha', () => {
    const payload = {
      commits: [
        { id: 'abc', message: 'fix #T-1', timestamp: '2026-01-01T00:00:00Z', url: 'u', author: { name: 'A', email: 'a@b.c' } },
        { message: 'no sha' },
      ],
    };
    const out = normalizeCommits(payload);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sha: 'abc', message: 'fix #T-1', author: 'A', authorEmail: 'a@b.c' });
  });
  it('returns [] for a non-push payload', () => {
    expect(normalizeCommits({ zen: 'ping' })).toEqual([]);
  });
});
