import { promises as dns, LookupAddress } from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP, LookupFunction } from 'net';

const blockedRanges = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this host"; connecting to 0.0.0.0 reaches localhost on Linux
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  blockedRanges.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
] as const) {
  blockedRanges.addSubnet(network, prefix, 'ipv6');
}

export class WebhookTargetError extends Error {}

/** IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are matched against the IPv4 ranges. */
export function isInternalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blockedRanges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Resolves a hostname and rejects it if any of its addresses is internal. */
export async function resolvePublicAddresses(
  hostname: string,
): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new WebhookTargetError(
      `Could not resolve webhook host ${host}: ${error.code || error.message}`,
    );
  }
  const internal = addresses.find(({ address }) => isInternalAddress(address));
  if (addresses.length === 0 || internal) {
    throw new WebhookTargetError(
      `Webhook host ${host} resolves to internal address ${internal?.address ?? '(none)'}; ` +
        'set WEBHOOK_ALLOW_INTERNAL=true to allow LAN webhooks',
    );
  }
  return addresses;
}

export async function assertPublicWebhookUrl(url: string): Promise<void> {
  await resolvePublicAddresses(new URL(url).hostname);
}

// Node skips `lookup` for IP literals, so callers must still run
// assertPublicWebhookUrl first; the agents close the DNS-rebinding gap between
// that check and the connection.
// Node calls this with `all: true` (autoSelectFamily) or without it, which
// expects (err, address, family); the typings only describe the first form.
function guardedLookup(
  hostname: string,
  options: { family?: number; all?: boolean },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  resolvePublicAddresses(hostname).then(
    (resolved) => {
      const addresses = options.family
        ? resolved.filter(({ family }) => family === options.family)
        : resolved;
      if (addresses.length === 0) {
        const error: NodeJS.ErrnoException = new Error(
          `No IPv${options.family} address for ${hostname}`,
        );
        error.code = 'ENOTFOUND';
        callback(error, '');
      } else if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    },
    (error) => callback(error, ''),
  );
}

const lookup = guardedLookup as unknown as LookupFunction;
export const guardedHttpAgent = new http.Agent({ lookup });
export const guardedHttpsAgent = new https.Agent({ lookup });
