const { ethers } = require('ethers');
const { ERROR_MESSAGES, USER_ROLES } = require('../config/constants');
const { getClient } = require('../config/database');

// =================================
// MIDDLEWARE DE AUTENTICACIÓN WEB3
// =================================

/**
 * Lista de wallets admin (desde variables de entorno)
 */
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
    .toLowerCase()
    .split(',')
    .filter(Boolean);

/**
 * Verifica una firma de mensaje de wallet
 * @param {string} message - Mensaje original
 * @param {string} signature - Firma del mensaje
 * @returns {string|null} - Direccion de wallet o null si es invalida
 */
function verifySignature(message, signature) {
    try {
        const recoveredAddress = ethers.verifyMessage(message, signature);
        return recoveredAddress.toLowerCase();
    } catch (error) {
        console.error('Error verificando firma:', error);
        return null;
    }
}

/**
 * Middleware para autenticar usuario por wallet
 * Espera headers:
 * - x-wallet-address: direccion de la wallet
 * - x-wallet-signature: firma del mensaje (opcional, para operaciones sensibles)
 * - x-wallet-message: mensaje firmado (opcional)
 */
async function authenticateWallet(req, res, next) {
    try {
        const walletAddress = req.headers['x-wallet-address'];
        console.log(`[Web3Auth] Received wallet address: ${walletAddress}`);

        if (!walletAddress) {
            return res.status(401).json({
                success: false,
                message: 'Wallet no proporcionada'
            });
        }

        // Validar formato de direccion
        if (!ethers.isAddress(walletAddress)) {
            return res.status(401).json({
                success: false,
                message: 'Direccion de wallet invalida'
            });
        }

        const normalizedAddress = walletAddress.toLowerCase();
        console.log(`[Web3Auth] Normalized address: ${normalizedAddress}`);

        // Si hay firma, verificarla
        const signature = req.headers['x-wallet-signature'];
        const message = req.headers['x-wallet-message'];

        if (signature && message) {
            const recoveredAddress = verifySignature(message, signature);

            if (recoveredAddress !== normalizedAddress) {
                return res.status(401).json({
                    success: false,
                    message: 'Firma de wallet invalida'
                });
            }
        }

        // Determinar rol
        const isAdmin = ADMIN_WALLETS.length === 0 || // Dev mode
                       ADMIN_WALLETS.includes(normalizedAddress);

        // Look up or create user in database
        let userId = null;
        try {
            const client = await getClient();

            // First, try to find user by wallet_address
            let userResult = await client.query(
                'SELECT id FROM users WHERE wallet_address = $1',
                [normalizedAddress]
            );

            if (userResult.rows.length === 0) {
                // Create new user with wallet address
                try {
                    userResult = await client.query(
                        `INSERT INTO users (username, email, password_hash, balance, wallet_address, created_at, updated_at)
                         VALUES ($1, $2, 'web3-auth', 1000, $3, NOW(), NOW())
                         RETURNING id`,
                        [normalizedAddress, `${normalizedAddress}@wallet.local`, normalizedAddress]
                    );
                    console.log('Auto-created user for wallet:', normalizedAddress, 'with ID:', userResult.rows[0]?.id);
                } catch (insertErr) {
                    // If insert fails (e.g., column doesn't exist), try again without wallet_address
                    if (insertErr.code === '42703') { // undefined_column
                        console.log('wallet_address column not found, run migration first');
                    }
                    throw insertErr;
                }
            }

            userId = userResult.rows[0]?.id;
            client.release();
        } catch (dbError) {
            console.error('Error with user lookup/creation:', dbError.message);
            // Continue with wallet address as fallback ID
        }

        // Agregar usuario al request
        req.user = {
            id: userId || normalizedAddress, // Use numeric ID if available, fallback to address
            address: normalizedAddress,
            role: isAdmin ? USER_ROLES.ADMIN : USER_ROLES.USER
        };

        next();

    } catch (error) {
        console.error('Error en autenticacion Web3:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Middleware para requerir verificacion de firma
 * Usa authenticateWallet pero requiere firma valida
 */
async function requireSignature(req, res, next) {
    const signature = req.headers['x-wallet-signature'];
    const message = req.headers['x-wallet-message'];

    if (!signature || !message) {
        return res.status(401).json({
            success: false,
            message: 'Firma requerida para esta operacion'
        });
    }

    // Continuar con authenticateWallet
    return authenticateWallet(req, res, next);
}

/**
 * Middleware para verificar que el usuario es admin (Web3)
 */
function requireAdminWallet(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: ERROR_MESSAGES.UNAUTHORIZED
        });
    }

    if (req.user.role !== USER_ROLES.ADMIN) {
        return res.status(403).json({
            success: false,
            message: ERROR_MESSAGES.FORBIDDEN
        });
    }

    next();
}

/**
 * Middleware opcional de autenticacion Web3
 * Si hay wallet, la agrega al request
 * Si no hay, continua sin error
 */
async function optionalWalletAuth(req, res, next) {
    try {
        const walletAddress = req.headers['x-wallet-address'];

        if (walletAddress && ethers.isAddress(walletAddress)) {
            const normalizedAddress = walletAddress.toLowerCase();
            const isAdmin = ADMIN_WALLETS.length === 0 ||
                           ADMIN_WALLETS.includes(normalizedAddress);

            req.user = {
                id: normalizedAddress,
                address: normalizedAddress,
                role: isAdmin ? USER_ROLES.ADMIN : USER_ROLES.USER
            };
        }

        next();

    } catch (error) {
        console.error('Error en autenticacion Web3 opcional:', error);
        next();
    }
}

module.exports = {
    authenticateWallet,
    requireSignature,
    requireAdminWallet,
    optionalWalletAuth,
    verifySignature,
    ADMIN_WALLETS
};
