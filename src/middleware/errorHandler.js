// =================================
// MIDDLEWARE DE MANEJO DE ERRORES
// =================================

/**
 * Middleware para manejar errores 404
 */
function notFound(req, res, next) {
    const error = new Error(`Ruta no encontrada - ${req.originalUrl}`);
    res.status(404);
    next(error);
}

/**
 * Middleware global de manejo de errores
 */
function errorHandler(err, req, res, next) {
    // Log del error
    console.error('Error:', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip
    });

    // Obtener código de estado
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    // Respuesta de error - ocultar detalles internos en produccion
    const isProduction = process.env.NODE_ENV === 'production';
    const safeMessage = isProduction && statusCode === 500
        ? 'Error interno del servidor'
        : err.message;

    res.status(statusCode).json({
        success: false,
        message: safeMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

module.exports = {
    notFound,
    errorHandler
};
