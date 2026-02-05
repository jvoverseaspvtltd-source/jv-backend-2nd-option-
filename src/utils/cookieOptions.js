const config = require('../config/env');

/**
 * Determine secure cookie settings based on request origin/host and environment.
 * - Any non-localhost origin/host -> Secure + SameSite=None (required for Vercel → Railway)
 * - Localhost (dev) -> non-secure + SameSite=Lax (works on http://localhost)
 */
const getCookieSecurityOptions = (req) => {
  const origin = req.headers.origin || '';
  const host = req.get('host') || '';

  const isLocalHost =
    origin.startsWith('http://localhost') ||
    origin.startsWith('https://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('https://127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1');

  const isProdEnv = config.nodeEnv === 'production';

  // Be safe: secure for any non-local request OR explicit production env
  const secure = isProdEnv || !isLocalHost;
  const sameSite = secure ? 'none' : 'lax';

  return { secure, sameSite };
};

module.exports = { getCookieSecurityOptions };


