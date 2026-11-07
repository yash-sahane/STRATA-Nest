import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { AuthEvents, type DomainEvent, type SessionsRevokedPayload } from '@strata/shared';
import { REDIS_CLIENT } from '../../../redis/redis.constants';

/**
 * Redis allowlist of active refresh-token `jti`s per user.
 * This is what makes refresh tokens REVOCABLE: rotation stores a
 * new jti and revokes the old one; logout revokes it; a jti the store does not
 * hold renews nothing (AuthService.refresh).
 */
@Injectable()
export class RefreshTokenStore {
  private readonly ttl: number;
  private readonly accessTtl: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    this.ttl = config.get<number>('JWT_REFRESH_TTL', 604800);
    this.accessTtl = config.get<number>('JWT_ACCESS_TTL', 900);
  }

  /**
   * When an account's sessions were last ended, in JWT seconds.
   *
   * Revoking refresh tokens stopped a session from being RENEWED and nothing
   * more: the access token it already held kept working, on every route and on
   * the socket, until it expired up to fifteen minutes later. "Reset your
   * password because somebody else may be in your account" left that somebody
   * in it. Any token issued before this moment is refused (JwtStrategy,
   * RealtimeAuthService). The mark only has to outlive the longest-lived access
   * token, after which no older one can be presented anyway.
   */
  private sessionsKey(userId: string): string {
    return `auth:sessions-revoked:${userId}`;
  }

  /** Seconds since the epoch before which this user's tokens are void; 0 for none.
   *  A store that cannot be read voids nothing — the choice every store here makes. */
  async revokedBefore(userId: string): Promise<number> {
    try {
      return Number(await this.redis.get(this.sessionsKey(userId))) || 0;
    } catch {
      return 0;
    }
  }

  private key(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  /** The jtis a user holds, so ending all their sessions reads one key, not the keyspace. */
  private userKey(userId: string): string {
    return `refresh-user:${userId}`;
  }

  async store(userId: string, jti: string): Promise<void> {
    await this.redis
      .multi()
      .set(this.key(userId, jti), '1', 'EX', this.ttl)
      .sadd(this.userKey(userId), jti)
      // The set lives as long as the newest token in it.
      .expire(this.userKey(userId), this.ttl)
      .exec();
  }

  /** Whether this refresh token still renews a session. */
  async isActive(userId: string, jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(userId, jti))) === 1;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.multi().del(this.key(userId, jti)).srem(this.userKey(userId), jti).exec();
  }

  /**
   * End every session of a user ("log out everywhere"): the refresh tokens, the
   * access tokens already handed out, and the sockets they opened.
   */
  async revokeAll(userId: string): Promise<void> {
    const jtis = await this.redis.smembers(this.userKey(userId));
    await this.redis.del(...jtis.map((jti) => this.key(userId, jti)), this.userKey(userId));
    await this.redis.set(
      this.sessionsKey(userId),
      String(Math.floor(Date.now() / 1000)),
      'EX',
      this.accessTtl,
    );
    const event: DomainEvent<SessionsRevokedPayload> = {
      name: AuthEvents.SessionsRevoked,
      payload: { userId },
      occurredAt: new Date().toISOString(),
    };
    this.events?.emit(AuthEvents.SessionsRevoked, event);
  }
}
