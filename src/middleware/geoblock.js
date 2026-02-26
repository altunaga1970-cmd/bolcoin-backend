/**
 * Middleware de Geoblocking
 * Bloquea requests de paises restringidos
 */

const axios = require('axios');

// Paises bloqueados (ISO country codes)
const BLOCKED_COUNTRIES = ['ES', 'US', 'GB', 'FR', 'DE', 'NL', 'IT', 'BE'];

// Nombres de paises para mensajes
const COUNTRY_NAMES = {
  ES: 'España',
  US: 'Estados Unidos',
  GB: 'Reino Unido',
  FR: 'Francia',
  DE: 'Alemania',
  NL: 'Países Bajos',
  IT: 'Italia',
  BE: 'Bélgica'
};

// Cache de IPs verificadas (en memoria, para produccion usar Redis)
const geoCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

// Limpiar cache periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of geoCache.entries()) {
    if (now - data.timestamp > CACHE_TTL) {
      geoCache.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Cada hora

/**
 * Obtener IP real del cliente
 */
const getClientIP = (req) => {
  // Verificar headers de proxies/load balancers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  // Cloudflare
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) {
    return cfIP;
  }

  return req.ip || req.connection?.remoteAddress || 'unknown';
};

/**
 * Verificar geolocalizacion de IP
 */
const checkGeoLocation = async (ip) => {
  // Verificar cache
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached;
  }

  try {
    // Primary: ipapi.co (HTTPS, 1000 req/day free)
    const response = await axios.get(`https://ipapi.co/${ip}/json/`, {
      timeout: 5000
    });

    if (response.data.country_code) {
      const geoData = {
        countryCode: response.data.country_code,
        country: response.data.country_name,
        blocked: BLOCKED_COUNTRIES.includes(response.data.country_code),
        timestamp: Date.now()
      };
      geoCache.set(ip, geoData);
      return geoData;
    }

    // Fallback: ip-api.com (HTTP only, 45 req/min)
    const altResponse = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`, {
      timeout: 5000
    });

    if (altResponse.data.status === 'success') {
      const geoData = {
        countryCode: altResponse.data.countryCode,
        country: altResponse.data.country,
        blocked: BLOCKED_COUNTRIES.includes(altResponse.data.countryCode),
        timestamp: Date.now()
      };
      geoCache.set(ip, geoData);
      return geoData;
    }

    return null;
  } catch (error) {
    console.error('Geo lookup error:', error.message);
    return null;
  }
};

/**
 * Middleware de geoblocking
 * Uso: app.use('/api', geoBlockMiddleware);
 */
const geoBlockMiddleware = async (req, res, next) => {
  // Skip en desarrollo
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_GEOBLOCK === 'true') {
    return next();
  }

  // Skip para rutas de health check
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  // Skip para endpoints publicos de solo lectura (info del juego, sin actividad monetaria)
  // req.path es relativo a la ruta de montaje (/api), ej: /bingo/rooms
  const PUBLIC_READ_PATHS = [
    '/bingo/rooms',
    '/bingo/config',
    '/public-config',
  ];
  if (PUBLIC_READ_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'))) {
    return next();
  }

  const clientIP = getClientIP(req);

  // Skip IPs locales/privadas
  if (isPrivateIP(clientIP)) {
    return next();
  }

  try {
    const geoData = await checkGeoLocation(clientIP);

    if (geoData && geoData.blocked) {
      const countryName = COUNTRY_NAMES[geoData.countryCode] || geoData.country;

      console.log(`[GeoBlock] Blocked request from ${countryName} (${clientIP})`);

      return res.status(403).json({
        error: 'Access Denied',
        message: `Lo sentimos, este servicio no está disponible en ${countryName} debido a regulaciones locales.`,
        code: 'GEO_BLOCKED',
        country: geoData.countryCode
      });
    }

    // Agregar info de geo al request para uso posterior
    req.geoData = geoData;
    next();
  } catch (error) {
    // Fail-close in production: block when geo lookup fails
    if (process.env.NODE_ENV === 'production' && process.env.GEOBLOCK_FAIL_OPEN !== 'true') {
      console.error('[GeoBlock] Geo lookup failed, blocking request (fail-close):', error.message);
      return res.status(403).json({
        error: 'Access Denied',
        message: 'No se pudo verificar tu ubicacion. Intenta de nuevo.',
        code: 'GEO_UNAVAILABLE'
      });
    }
    // In development or if explicitly configured, fail-open
    console.error('[GeoBlock] Error (fail-open):', error.message);
    next();
  }
};

/**
 * Verificar si es IP privada/local
 */
const isPrivateIP = (ip) => {
  if (!ip || ip === 'unknown') return true;

  // IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;

  // IPv4 privadas
  const privateRanges = [
    /^127\./,           // Loopback
    /^10\./,            // Class A private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
    /^192\.168\./,      // Class C private
    /^169\.254\./,      // Link-local
    /^fc00:/i,          // IPv6 unique local
    /^fe80:/i           // IPv6 link-local
  ];

  return privateRanges.some(range => range.test(ip));
};

/**
 * Middleware ligero solo para logging (sin bloqueo)
 */
const geoLogMiddleware = async (req, res, next) => {
  const clientIP = getClientIP(req);

  if (!isPrivateIP(clientIP)) {
    const geoData = await checkGeoLocation(clientIP);
    if (geoData) {
      req.geoData = geoData;
      console.log(`[GeoLog] Request from ${geoData.country} (${clientIP})`);
    }
  }

  next();
};

module.exports = {
  geoBlockMiddleware,
  geoLogMiddleware,
  checkGeoLocation,
  getClientIP,
  BLOCKED_COUNTRIES,
  COUNTRY_NAMES
};
