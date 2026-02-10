const app = require('./app');
const db = require('./config/database');
const { testConnection } = db;
const scheduler = require('./scheduler');
const vrfService = require('./services/vrfService');
require('dotenv').config();

// =================================
// CONFIGURACIÓN DEL SERVIDOR
// =================================

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENABLE_SCHEDULER = process.env.ENABLE_SCHEDULER !== 'false';

// =================================
// INICIAR SERVIDOR
// =================================

async function startServer() {
    // ==========================================
    // STEP 1: Start Express ALWAYS
    // ==========================================
    const server = app.listen(PORT, () => {
        console.log('=================================');
        console.log('SERVIDOR LA BOLITA INICIADO');
        console.log('=================================');
        console.log(`Entorno: ${NODE_ENV}`);
        console.log(`URL: http://localhost:${PORT}`);
        console.log(`API: http://localhost:${PORT}/api`);
        console.log(`Salud: http://localhost:${PORT}/health`);
        console.log('=================================\n');
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Error: El puerto ${PORT} ya esta en uso`);
        } else {
            console.error('Error del servidor:', error);
        }
        process.exit(1);
    });

    // ==========================================
    // STEP 2: Try DB connection + auto-init (non-fatal)
    // ==========================================
    let dbConnected = false;
    try {
        console.log('Probando conexion a PostgreSQL...');
        dbConnected = await testConnection();
        if (dbConnected) {
            db.setDbAvailable(true);
            console.log('Conexion a PostgreSQL exitosa');

            // Auto-initialize database schema + migrations on first deploy
            try {
                const { initDatabase } = require('./db/init');
                await initDatabase();
            } catch (initErr) {
                console.error('[DEGRADED] DB init error (non-fatal):', initErr.message);
            }
        } else {
            console.error('[DEGRADED] No se pudo conectar a PostgreSQL. API operativa sin DB.');
        }
    } catch (error) {
        console.error('[DEGRADED] Error conectando a PostgreSQL:', error.message);
    }

    // ==========================================
    // STEP 3: VRF + Scheduler only if DB is up
    // ==========================================
    let vrfInitialized = false;

    if (dbConnected) {
        try {
            console.log('Inicializando servicio VRF...');
            vrfInitialized = await vrfService.initialize();
            if (vrfInitialized) {
                console.log('Servicio VRF inicializado');
                await vrfService.startEventListener();
            } else {
                console.log('Servicio VRF en modo simulacion (sin OPERATOR_PRIVATE_KEY)');
            }
        } catch (error) {
            console.error('[DEGRADED] Error inicializando VRF (no fatal):', error.message);
        }

        if (ENABLE_SCHEDULER) {
            try {
                console.log('Iniciando scheduler de sorteos...');
                await scheduler.start();
            } catch (error) {
                console.error('[DEGRADED] Error iniciando scheduler (no fatal):', error.message);
            }
        } else {
            console.log('Scheduler deshabilitado (ENABLE_SCHEDULER=false)');
        }
    } else {
        console.log('[DEGRADED] VRF y Scheduler omitidos (DB no disponible)');
    }

    console.log(`Scheduler: ${ENABLE_SCHEDULER && dbConnected ? 'ACTIVO' : 'DESACTIVADO'}`);
    console.log(`VRF: ${vrfInitialized ? 'PRODUCCION' : 'SIMULACION'}`);
    console.log(`DB: ${dbConnected ? 'CONECTADA' : 'DEGRADED MODE'}`);

    // ==========================================
    // Graceful shutdown
    // ==========================================
    const gracefulShutdown = async (signal) => {
        console.log(`\n${signal} recibido. Cerrando servidor...`);

        if (ENABLE_SCHEDULER && dbConnected) {
            await scheduler.stop();
        }
        vrfService.stopEventListener();

        server.close(() => {
            console.log('Servidor cerrado correctamente');
            process.exit(0);
        });

        setTimeout(() => {
            console.error('Cierre forzado despues de timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Iniciar el servidor
startServer();
