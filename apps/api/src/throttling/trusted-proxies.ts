import { Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** How often a proxy named by host name is looked up again (its container may be recreated). */
const RESOLVE_EVERY_MS = 60_000;

type Resolver = (host: string) => Promise<string[]>;

const resolveHost: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

/** `::ffff:10.0.0.7` is the IPv4 address 10.0.0.7 arriving on a dual-stack socket. */
const unmap = (address: string): string => address.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

const familyOf = (ip: string): 'ipv4' | 'ipv6' | null => {
  const family = isIP(ip);
  return family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : null;
};

/**
 * The proxies allowed to say where a request came from (TRUSTED_PROXIES).
 *
 * The address rate limits and sign-in lockouts are keyed on used to be read from
 * X-Real-IP / X-Forwarded-For whenever the connection came from ANY private
 * address, on the theory that only a proxy sits there. It is not only a proxy: the
 * compose stack publishes the API's port, so a machine on the office LAN, or
 * anything Docker's port proxy forwards (it connects from the bridge gateway, a
 * private address), was believed too — and could name a fresh address on every
 * request. That is an unlimited supply of sign-in attempts, a colleague's account
 * locked out through the account-wide ceiling, and as many reset mails as wanted.
 *
 * So only the proxies named here are believed. Comma-separated; each entry is an
 * address (`10.0.0.5`, `::1`), a range (`10.0.0.0/24`), `loopback`, or a host name
 * looked up in DNS (`nginx`, the compose service — its address changes whenever the
 * container is recreated, which is why a name is allowed). Unset, it is `loopback`:
 * a proxy on the same machine. Empty, nobody is believed.
 */
export class TrustedProxies {
  private readonly logger = new Logger('TrustedProxies');
  private readonly ranges = new BlockList();
  private readonly hostnames: string[] = [];
  /** Each host name's addresses, as last looked up. */
  private readonly byHost = new Map<string, string[]>();
  private resolved = new Set<string>();
  private resolvedAt = 0;
  private resolving: Promise<void> | null = null;

  constructor(
    spec: string,
    private readonly resolve: Resolver = resolveHost,
  ) {
    for (const raw of spec.split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      if (entry.toLowerCase() === 'loopback') {
        this.ranges.addSubnet('127.0.0.0', 8, 'ipv4');
        this.ranges.addAddress('::1', 'ipv6');
        continue;
      }
      const [address, prefix, ...rest] = entry.split('/');
      const family = familyOf(unmap(address));
      if (family && prefix === undefined) {
        this.ranges.addAddress(unmap(address), family);
      } else if (family && rest.length === 0 && /^\d{1,3}$/.test(prefix)) {
        // Throws on a prefix the family cannot have (/33 for IPv4) — at boot, which
        // is when a typo in who-to-trust should be found.
        this.ranges.addSubnet(unmap(address), Number(prefix), family);
      } else if (/^[a-z0-9_][a-z0-9_.-]*$/i.test(entry) && !/^[\d.]+$/.test(entry)) {
        // (All digits and dots is a mistyped address, not a name.)
        this.hostnames.push(entry.toLowerCase());
      } else {
        throw new Error(
          `TRUSTED_PROXIES: "${entry}" is not an address, a range, "loopback" or a host name.`,
        );
      }
    }
    // Looked up now rather than on the first request, so that request is not keyed
    // on the proxy's own address while the answer is still on its way.
    this.refresh();
  }

  /** Whether the connection's own peer is a proxy whose forwarding headers are believed. */
  has(address: string): boolean {
    const ip = unmap(address);
    const family = familyOf(ip);
    if (!family) return false;
    if (this.ranges.check(ip, family)) return true;
    if (this.hostnames.length === 0) return false;
    if (Date.now() - this.resolvedAt > RESOLVE_EVERY_MS) this.refresh();
    return this.resolved.has(ip);
  }

  /** Settles once the host names have been looked up (for tests; requests never wait). */
  ready(): Promise<void> {
    return this.resolving ?? Promise.resolve();
  }

  private refresh(): void {
    if (this.hostnames.length === 0 || this.resolving) return;
    this.resolving = (async () => {
      for (const host of this.hostnames) {
        try {
          this.byHost.set(host, (await this.resolve(host)).map(unmap));
        } catch (err) {
          // A failed lookup keeps that host's last answer: a DNS blip must not
          // suddenly key every request through the proxy on the proxy's own address.
          this.logger.warn(`could not look up trusted proxy "${host}": ${(err as Error).message}`);
        }
      }
      this.resolved = new Set([...this.byHost.values()].flat());
      this.resolvedAt = Date.now();
    })().finally(() => {
      this.resolving = null;
    });
  }
}
