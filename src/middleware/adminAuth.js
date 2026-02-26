const { verifyToken, extractToken } = require('../config/auth');
const { isAdminWallet, getAdminRole, ROLE_PERMISSIONS } = require('../config/adminWallets');

/**
 * Middleware unificado: Verificar JWT admin
 * Extrae JWT de Authorization: Bearer o x-admin-token,
 * verifica firma, valida que wallet sigue siendo admin,
 * y setea req.admin con address, role y permissions.
 */
function requireAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        const token = extractToken(authHeader) || req.headers['x-admin-token'];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token de admin requerido'
            });
        }

        let decoded;
        try {
            decoded = verifyToken(token);
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Token invalido o expirado. Por favor, vuelve a iniciar sesion.'
            });
        }

        // Verificar que es un token admin
        if (decoded.type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Token no es de tipo admin'
            });
        }

        // Verificar que la wallet sigue siendo admin
        if (!isAdminWallet(decoded.address)) {
            return res.status(403).json({
                success: false,
                message: 'Wallet ya no tiene permisos de admin'
            });
        }

        // Setear req.admin con permisos FRESCOS (no del JWT cache)
        const freshRole = getAdminRole(decoded.address);
        const freshPermissions = ROLE_PERMISSIONS[freshRole] || [];
        req.admin = {
            address: decoded.address,
            role: freshRole,
            permissions: freshPermissions
        };

        // Compatibilidad: algunas rutas usan req.user.address
        req.user = {
            address: decoded.address,
            role: decoded.role
        };

        next();
    } catch (error) {
        console.error('[AdminAuth] Error verificando token:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno de autenticacion'
        });
    }
}

/**
 * Factory middleware: Verificar permiso especifico
 * Usar despues de requireAdmin
 */
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                message: 'Autenticacion admin requerida'
            });
        }

        if (!req.admin.permissions.includes(permission)) {
            return res.status(403).json({
                success: false,
                message: `Permiso requerido: ${permission}`
            });
        }

        next();
    };
}

module.exports = {
    requireAdmin,
    requirePermission
};
