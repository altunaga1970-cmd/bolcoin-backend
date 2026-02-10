const { Pool } = require('pg');
require('dotenv').config();

let dbAvailable = false;

// Sanitize DATABASE_URL - Railway sometimes has prefix issues
function sanitizeDatabaseUrl(url) {
    if (!url) return url;
    // Fix: "railwaypostgresql://..." -> "postgresql://..."
    const pgIndex = url.indexOf('postgresql://');
    if (pgIndex > 0) {
        const fixed = url.substring(pgIndex);
        console.log('[DB] Fixed malformed DATABASE_URL (removed prefix before postgresql://)');
        return fixed;
    }
    // Fix: "postgres://" -> "postgresql://" (some providers use short form)
    if (url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
        return url.replace('postgres://', 'postgresql://');
    }
    return url;
}

const databaseUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL);

// Log connection info (hide password)
if (databaseUrl) {
    const safeUrl = databaseUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
    console.log('[DB] DATABASE_URL:', safeUrl);
} else {
    console.error('[DB] WARNING: DATABASE_URL is not set! Database will not connect.');
}

// Configuración del pool de conexiones a PostgreSQL
const pool = new Pool({
    connectionString: databaseUrl,
    max: parseInt(process.env.DATABASE_POOL_MAX) || 10,
    min: parseInt(process.env.DATABASE_POOL_MIN) || 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
});

// Evento cuando se crea una nueva conexión
pool.on('connect', () => {
    dbAvailable = true;
    console.log('[DB] Conexion establecida con PostgreSQL');
});

// Evento cuando hay un error en el pool
pool.on('error', (err) => {
    dbAvailable = false;
    console.error('[DB] Error inesperado en el pool de PostgreSQL:', err);
});

// Función helper para ejecutar queries con manejo de errores
const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Query ejecutada:', { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('Error en query:', { text, error: error.message });
        throw error;
    }
};

// Función para obtener un cliente del pool (para transacciones)
const getClient = async () => {
    const client = await pool.connect();
    const originalQuery = client.query.bind(client);
    const originalRelease = client.release.bind(client);

    // Agregar timeout para evitar que se quede bloqueado
    const timeout = setTimeout(() => {
        console.error('⚠ Cliente no fue liberado después de 5 segundos');
    }, 5000);

    // Sobrescribir release para limpiar timeout
    client.release = () => {
        clearTimeout(timeout);
        client.release = originalRelease;
        return originalRelease();
    };

    return client;
};

// Función para verificar la conexión
const testConnection = async () => {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('✓ Conexión a PostgreSQL exitosa:', res.rows[0].now);
        return true;
    } catch (error) {
        console.error('✗ Error conectando a PostgreSQL:', error.message || error.code || error);
        if (error.code) console.error('  Error code:', error.code);
        if (error.errno) console.error('  Errno:', error.errno);
        return false;
    }
};

module.exports = {
    pool,
    query,
    getClient,
    testConnection,
    get dbAvailable() { return dbAvailable; },
    setDbAvailable(val) { dbAvailable = val; }
};
