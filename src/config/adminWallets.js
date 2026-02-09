// =================================
// CONFIGURACIÓN DE WALLETS ADMIN
// =================================

/**
 * Roles de administrador
 */
const ADMIN_ROLES = {
    SUPERADMIN: 'superadmin',  // Acceso total, puede modificar otros admins
    OPERATOR: 'operator',      // Puede gestionar sorteos y ver estadísticas
    AUDITOR: 'auditor'         // Solo lectura, acceso a logs y reportes
};

/**
 * Permisos por rol
 */
const ROLE_PERMISSIONS = {
    [ADMIN_ROLES.SUPERADMIN]: [
        'admin:read',
        'admin:write',
        'draws:manage',
        'draws:results',
        'users:manage',
        'config:read',
        'config:write',
        'audit:read',
        'scheduler:manage',
        'withdrawals:manage',
        'admins:manage'
    ],
    [ADMIN_ROLES.OPERATOR]: [
        'admin:read',
        'draws:manage',
        'draws:results',
        'users:read',
        'config:read',
        'audit:read',
        'scheduler:read',
        'withdrawals:manage'
    ],
    [ADMIN_ROLES.AUDITOR]: [
        'admin:read',
        'draws:read',
        'users:read',
        'config:read',
        'audit:read',
        'scheduler:read',
        'withdrawals:read'
    ]
};

/**
 * Cargar wallets admin desde variable de entorno
 * Formato: address1:role,address2:role
 * Ejemplo: 0x123...abc:superadmin,0x456...def:operator
 */
function loadAdminWallets() {
    const adminWalletsEnv = process.env.ADMIN_WALLETS || '';
    const wallets = {};

    if (!adminWalletsEnv) {
        console.warn('[AdminWallets] ADMIN_WALLETS no configurado. Ningun wallet tendra acceso admin.');
        return wallets;
    }

    const entries = adminWalletsEnv.split(',').filter(Boolean);

    for (const entry of entries) {
        const [address, role] = entry.split(':');
        if (address) {
            const normalizedAddress = address.toLowerCase().trim();
            const adminRole = role?.trim() || ADMIN_ROLES.OPERATOR;

            // Validar rol
            if (!Object.values(ADMIN_ROLES).includes(adminRole)) {
                console.warn(`Rol inválido para ${normalizedAddress}: ${adminRole}. Usando 'operator'.`);
                wallets[normalizedAddress] = ADMIN_ROLES.OPERATOR;
            } else {
                wallets[normalizedAddress] = adminRole;
            }
        }
    }

    console.log(`[AdminWallets] ${Object.keys(wallets).length} wallets admin configuradas:`);
    for (const [addr, role] of Object.entries(wallets)) {
        console.log(`  - ${addr.substring(0, 10)}...${addr.substring(addr.length - 6)} : ${role}`);
    }
    return wallets;
}

// Cache de wallets admin
let adminWalletsCache = null;

/**
 * Obtener wallets admin (con cache)
 */
function getAdminWallets() {
    if (!adminWalletsCache) {
        adminWalletsCache = loadAdminWallets();
    }
    return adminWalletsCache;
}

/**
 * Verificar si una wallet es admin
 */
function isAdminWallet(address) {
    if (!address) return false;
    const wallets = getAdminWallets();

    // Si no hay wallets configuradas, NO permitir acceso
    if (Object.keys(wallets).length === 0) {
        return false;
    }

    return address.toLowerCase() in wallets;
}

/**
 * Obtener rol de una wallet admin
 */
function getAdminRole(address) {
    if (!address) return null;
    const wallets = getAdminWallets();

    // Si no hay wallets configuradas, no asignar rol
    if (Object.keys(wallets).length === 0) {
        return null;
    }

    return wallets[address.toLowerCase()] || null;
}

/**
 * Verificar si una wallet tiene un permiso específico
 */
function hasPermission(address, permission) {
    const role = getAdminRole(address);
    if (!role) return false;

    const permissions = ROLE_PERMISSIONS[role] || [];
    return permissions.includes(permission);
}

/**
 * Recargar wallets admin (útil si se actualiza la config)
 */
function reloadAdminWallets() {
    adminWalletsCache = loadAdminWallets();
    return adminWalletsCache;
}

module.exports = {
    ADMIN_ROLES,
    ROLE_PERMISSIONS,
    getAdminWallets,
    isAdminWallet,
    getAdminRole,
    hasPermission,
    reloadAdminWallets
};
