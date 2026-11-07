/**
 * Whether a string is a Discord webhook URL — https, on a Discord host, and on
 * the webhook path.
 *
 * A stored webhook URL is something the SERVER later makes a request to, so it
 * is attacker-influenced input pointed at the network the server sits in. The
 * API checks this before saving one and the worker checks it again before
 * posting, because rows written before the first check existed are still there.
 */
export function isDiscordWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  const onDiscord =
    host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com');
  return onDiscord && url.pathname.startsWith('/api/webhooks/');
}
