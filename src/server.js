const app = require('./app');
const { testConnection } = require('./config/database');
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
    try {
        // Probar conexión a la base de datos
        console.log('Probando conexion a PostgreSQL...');
        const dbConnected = await testConnection();

        if (!dbConnected) {
            console.error('No se pudo conectar a la base de datos');
            console.error('Verifica que PostgreSQL este ejecutandose y que las credenciales en .env sean correctas');
            process.exit(1);
        }

        console.log('Conexion a PostgreSQL exitosa\n');

        // Inicializar servicio VRF
        console.log('Inicializando servicio VRF...');
        const vrfInitialized = await vrfService.initialize();
        if (vrfInitialized) {
            console.log('Servicio VRF inicializado');
            // Iniciar listener de eventos VRF
            await vrfService.startEventListener();
        } else {
            console.log('Servicio VRF en modo simulacion (sin OPERATOR_PRIVATE_KEY)');
        }

        // Iniciar scheduler si está habilitado
        if (ENABLE_SCHEDULER) {
            console.log('Iniciando scheduler de sorteos...');
            await scheduler.start();
        } else {
            console.log('Scheduler deshabilitado (ENABLE_SCHEDULER=false)');
        }

        // Iniciar servidor Express
        const server = app.listen(PORT, () => {
            console.log('=================================');
            console.log('SERVIDOR LA BOLITA INICIADO');
            console.log('=================================');
            console.log(`Entorno: ${NODE_ENV}`);
            console.log(`URL: http://localhost:${PORT}`);
            console.log(`API: http://localhost:${PORT}/api`);
            console.log(`Salud: http://localhost:${PORT}/health`);
            console.log(`Scheduler: ${ENABLE_SCHEDULER ? 'ACTIVO' : 'DESACTIVADO'}`);
            console.log(`VRF: ${vrfInitialized ? 'PRODUCCION' : 'SIMULACION'}`);
            console.log('=================================\n');
        });

        // Manejo de errores del servidor
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Error: El puerto ${PORT} ya esta en uso`);
            } else {
                console.error('Error del servidor:', error);
            }
            process.exit(1);
        });

        // Manejo de cierre graceful
        const gracefulShutdown = async (signal) => {
            console.log(`\n${signal} recibido. Cerrando servidor...`);

            // Detener scheduler
            if (ENABLE_SCHEDULER) {
                await scheduler.stop();
            }

            // Detener VRF listener
            vrfService.stopEventListener();

            server.close(() => {
                console.log('Servidor cerrado correctamente');
                process.exit(0);
            });

            // Forzar cierre después de 10 segundos
            setTimeout(() => {
                console.error('Cierre forzado después de timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error('Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Iniciar el servidor
startServer();


