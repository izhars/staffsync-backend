// utils/punchVerification.js

/**
 * Exact IP whitelist (comma-separated in env).
 * Example: OFFICE_IP_WHITELIST=161.248.69.178,192.168.1.51
 */
const OFFICE_IP_WHITELIST = (process.env.OFFICE_IP_WHITELIST || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

/**
 * Subnet (CIDR) whitelist (comma-separated in env).
 * Example: OFFICE_SUBNET_WHITELIST=192.168.1.0/24,10.0.0.0/8
 */
const OFFICE_SUBNET_WHITELIST = (process.env.OFFICE_SUBNET_WHITELIST || '')
  .split(',')
  .map((cidr) => cidr.trim())
  .filter(Boolean);

const PRIVILEGED_ROLES = ['hr', 'admin'];

/**
 * Extract client IP safely behind proxies.
 * Handles:
 *  - x-forwarded-for chains (takes first hop)
 *  - IPv6-mapped IPv4 (::ffff:192.168.1.51)
 *  - direct socket fallback
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ip;

  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  } else {
    ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
  }

  // Normalize IPv6-mapped IPv4 → IPv4
  return ip.replace(/^::ffff:/, '');
}

/**
 * Convert an IPv4 string to a 32-bit unsigned integer.
 * Returns null if not a valid IPv4.
 */
function ipv4ToInt(ip) {
  if (typeof ip !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address falls within a CIDR range.
 * Example: ipv4InCidr("192.168.1.51", "192.168.1.0/24") === true
 */
function ipv4InCidr(ip, cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) return false;

  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Is the request coming from the office network?
 * Checks exact IP list first, then subnet list.
 * If neither is configured, allows (dev/staging mode).
 */
function isOfficeNetwork(req) {
  const ip = getClientIp(req);
  const configured =
    OFFICE_IP_WHITELIST.length > 0 || OFFICE_SUBNET_WHITELIST.length > 0;

  if (!configured) {
    // No whitelist configured → allow (dev/staging)
    return { isOffice: true, ip, configured: false, matchedBy: 'NONE_CONFIGURED' };
  }

  if (OFFICE_IP_WHITELIST.includes(ip)) {
    return { isOffice: true, ip, configured: true, matchedBy: 'EXACT_IP' };
  }

  const matchedSubnet = OFFICE_SUBNET_WHITELIST.find((cidr) =>
    ipv4InCidr(ip, cidr)
  );
  if (matchedSubnet) {
    return {
      isOffice: true,
      ip,
      configured: true,
      matchedBy: `SUBNET:${matchedSubnet}`,
    };
  }

  return { isOffice: false, ip, configured: true, matchedBy: null };
}

/**
 * Decide how to verify a punch.
 *
 * @param {Object}  params
 * @param {Object}  params.req        Express request
 * @param {Object}  params.user       User doc (must have .role)
 * @param {boolean} params.hasCoords  Whether valid GPS coords were sent
 *
 * @returns {{
 *   allowed: boolean,
 *   method: 'GPS'|'OFFICE_NETWORK'|'BYPASS_PRIVILEGED'|'BYPASS_NO_GPS_PRIVILEGED',
 *   bypass: boolean,
 *   reason?: string,
 *   clientIp: string,
 *   punchedFrom: 'mobile'|'desktop',
 *   networkMatch?: string|null
 * }}
 */
function evaluatePunchVerification({ req, user, hasCoords, isDesktop }) {
  const role = user?.role;
  const isPrivileged = PRIVILEGED_ROLES.includes(role);
  const { isOffice, ip, configured, matchedBy } = isOfficeNetwork(req);

  // Prefer an explicit hint from the client; fall back to GPS presence.
  // Client should send `punchedFrom` (or we detect via user-agent).
  const punchedFrom =
    isDesktop ?? (hasCoords ? 'mobile' : 'desktop');

  // ── 1. Mobile / GPS present → normal path (geo-fence still runs)
  if (hasCoords) {
    return {
      allowed: true,
      method: 'GPS',
      bypass: false,
      clientIp: ip,
      punchedFrom,
      networkMatch: matchedBy,
    };
  }

  // ── 2. No GPS + on office network → allow (any role)
  if (isOffice && configured) {
    return {
      allowed: true,
      method: 'OFFICE_NETWORK',
      bypass: true,
      reason: `Desktop punch verified via office network (${matchedBy})`,
      clientIp: ip,
      punchedFrom,
      networkMatch: matchedBy,
    };
  }

  // ── 3. No GPS + whitelist not configured (dev/staging) → allow privileged only
  if (isOffice && !configured) {
    if (isPrivileged) {
      return {
        allowed: true,
        method: 'BYPASS_NO_GPS_PRIVILEGED',
        bypass: true,
        reason: 'HR/Admin desktop punch — office IP whitelist not configured',
        clientIp: ip,
        punchedFrom,
        networkMatch: matchedBy,
      };
    }
    return {
      allowed: false,
      method: 'GPS',
      bypass: false,
      reason: 'NO_LOCATION',
      clientIp: ip,
      punchedFrom,
      networkMatch: matchedBy,
    };
  }

  // ── 4. No GPS + not on office network
  if (isPrivileged) {
    return {
      allowed: false,
      method: 'OFFICE_NETWORK',
      bypass: false,
      reason: 'NOT_ON_OFFICE_NETWORK',
      clientIp: ip,
      punchedFrom,
      networkMatch: matchedBy,
    };
  }
  return {
    allowed: false,
    method: 'GPS',
    bypass: false,
    reason: 'NO_LOCATION',
    clientIp: ip,
    punchedFrom,
    networkMatch: matchedBy,
  };
}

module.exports = {
  evaluatePunchVerification,
  getClientIp,
  isOfficeNetwork,
  ipv4InCidr,
  PRIVILEGED_ROLES,
  OFFICE_IP_WHITELIST,
  OFFICE_SUBNET_WHITELIST,
};