import { BlockList, isIP } from 'node:net'

export type AddressClass = 'public' | 'private' | 'forbidden'

// Loopback, RFC 1918, carrier-grade NAT and unique-local ranges: allowed only
// when private-network targets are permitted (e.g. localhost/Docker on desktop).
const privateRanges = new BlockList()
privateRanges.addSubnet('127.0.0.0', 8, 'ipv4')
privateRanges.addSubnet('10.0.0.0', 8, 'ipv4')
privateRanges.addSubnet('172.16.0.0', 12, 'ipv4')
privateRanges.addSubnet('192.168.0.0', 16, 'ipv4')
privateRanges.addSubnet('100.64.0.0', 10, 'ipv4')
privateRanges.addAddress('::1', 'ipv6')
privateRanges.addSubnet('fc00::', 7, 'ipv6')

// Never reachable from Studio: unspecified, link-local (including cloud
// metadata services), multicast, broadcast, and reserved ranges.
const forbiddenRanges = new BlockList()
forbiddenRanges.addSubnet('0.0.0.0', 8, 'ipv4')
forbiddenRanges.addSubnet('169.254.0.0', 16, 'ipv4')
forbiddenRanges.addSubnet('224.0.0.0', 4, 'ipv4')
forbiddenRanges.addSubnet('240.0.0.0', 4, 'ipv4')
forbiddenRanges.addAddress('::', 'ipv6')
forbiddenRanges.addSubnet('fe80::', 10, 'ipv6')
forbiddenRanges.addSubnet('ff00::', 8, 'ipv6')

function unmapIpv4 (address: string): string {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return match?.[1] ?? address
}

export function classifyAddress (rawAddress: string): AddressClass {
  const address = unmapIpv4(rawAddress)
  const family = isIP(address)
  if (family === 0) {
    return 'forbidden'
  }
  const type = family === 4 ? 'ipv4' : 'ipv6'
  if (forbiddenRanges.check(address, type)) {
    return 'forbidden'
  }
  return privateRanges.check(address, type) ? 'private' : 'public'
}

export interface AddressPolicy {
  allowPrivateNetwork: boolean
}

/** Returns a reason when the address must not be contacted, otherwise null. */
export function rejectAddress (address: string, protocol: string, policy: AddressPolicy): string | null {
  const addressClass = classifyAddress(address)
  if (addressClass === 'forbidden') {
    return `address ${address} is in a forbidden range`
  }
  if (addressClass === 'private' && !policy.allowPrivateNetwork) {
    return `address ${address} is private or loopback and private-network targets are not allowed`
  }
  // Plain HTTP never leaves a trusted local or private network.
  if (protocol === 'http:' && addressClass === 'public') {
    return 'plain HTTP is only allowed for loopback and private-network addresses; use HTTPS'
  }
  return null
}

/** Static URL checks that do not need DNS. Returns a reason or null. */
export function rejectUrl (url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'only http and https URLs are allowed'
  }
  if (url.username || url.password) {
    return 'URLs must not contain credentials'
  }
  if (url.hash) {
    return 'URLs must not contain a fragment'
  }
  return null
}
