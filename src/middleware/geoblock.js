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
    // Usar ip-api.com (gratis, 45 requests/min)
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`, {
      timeout: 5000
    });

    if (response.data.status === 'success') {
      const geoData = {
        countryCode: response.data.countryCode,
        country: response.data.country,
        blocked: BLOCKED_COUNTRIES.includes(response.data.countryCode),
        timestamp: Date.now()
      };
      geoCache.set(ip, geoData);
      return geoData;
    }

    // Si falla, intentar con ipapi.co
    const altResponse = await axios.get(`https://ipapi.co/${ip}/json/`, {
      timeout: 5000
    });

    if (altResponse.data.country_code) {
      const geoData = {
        countryCode: altResponse.data.country_code,
        country: altResponse.data.country_name,
        blocked: BLOCKED_COUNTRIES.includes(altResponse.data.country_code),
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
    // En caso de error, permitir (fail-open)
    console.error('[GeoBlock] Error:', error.message);
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
