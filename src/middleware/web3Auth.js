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
 * - x-wallet-signature: firma del mensaje (OBLIGATORIO)
 * - x-wallet-message: mensaje firmado (OBLIGATORIO)
 */
async function authenticateWallet(req, res, next) {
    try {
        const walletAddress = req.headers['x-wallet-address'];

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

        // Firma OBLIGATORIA - verificar identidad criptografica
        const signature = req.headers['x-wallet-signature'];
        const message = req.headers['x-wallet-message'];

        // Signature is ALWAYS required - no dev bypass
        const skipSignature = process.env.UNSAFE_SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production';
        if (!skipSignature && (!signature || !message)) {
            return res.status(401).json({
                success: false,
                message: 'Firma de wallet requerida'
            });
        }

        if (!skipSignature) {
            // Validate message format: "Bolcoin Auth: <address> at <timestamp>"
            // Accepts both day-based timestamps (legacy) and second-based timestamps
            const messageRegex = /^Bolcoin Auth: (0x[a-f0-9]{40}) at (\d+)$/;
            const match = message.match(messageRegex);
            if (!match) {
                return res.status(401).json({
                    success: false,
                    message: 'Formato de mensaje de autenticacion invalido'
                });
            }

            // Verify the message address matches the claimed address
            if (match[1] !== normalizedAddress) {
                return res.status(401).json({
                    success: false,
                    message: 'Direccion en mensaje no coincide'
                });
            }

            // Verify timestamp is not too old (max 5 minutes)
            const messageTs = parseInt(match[2]);
            const nowSeconds = Math.floor(Date.now() / 1000);
            // Detect if timestamp is in seconds (> 1e9) or days (< 1e6)
            const isSecondsTimestamp = messageTs > 1_000_000_000;
            if (isSecondsTimestamp) {
                // New format: seconds-based, 5-minute window
                if (Math.abs(nowSeconds - messageTs) > 300) {
                    return res.status(401).json({
                        success: false,
                        message: 'Firma expirada. Reconecta tu wallet.'
                    });
                }
            } else {
                // Legacy format: day-based, 5-minute tolerance via day boundary
                const currentDayTs = Math.floor(Date.now() / 86400000);
                if (Math.abs(currentDayTs - messageTs) > 0) {
                    return res.status(401).json({
                        success: false,
                        message: 'Firma expirada. Reconecta tu wallet.'
                    });
                }
            }

            const recoveredAddress = verifySignature(message, signature);

            if (recoveredAddress !== normalizedAddress) {
                return res.status(401).json({
                    success: false,
                    message: 'Firma de wallet invalida'
                });
            }
        }

        // Determinar rol - ADMIN_WALLETS vacio = nadie es admin (no dev exception)
        const isAdmin = ADMIN_WALLETS.includes(normalizedAddress);

        // Look up or create user in database
        let userId = null;
        let client = null;
        try {
            client = await getClient();

            // First, try to find user by wallet_address
            let userResult = await client.query(
                'SELECT id FROM users WHERE wallet_address = $1',
                [normalizedAddress]
            );

            if (userResult.rows.length === 0) {
                // Create new user with wallet address
                userResult = await client.query(
                    `INSERT INTO users (username, email, password_hash, balance, wallet_address, created_at, updated_at)
                     VALUES ($1, $2, 'web3-auth', 0, $3, NOW(), NOW())
                     ON CONFLICT (wallet_address) DO NOTHING
                     RETURNING id`,
                    [normalizedAddress, `${normalizedAddress}@wallet.local`, normalizedAddress]
                );

                // If ON CONFLICT hit, re-fetch
                if (userResult.rows.length === 0) {
                    userResult = await client.query(
                        'SELECT id FROM users WHERE wallet_address = $1',
                        [normalizedAddress]
                    );
                }
            }

            userId = userResult.rows[0]?.id;

            // DEV: Auto-fund new users with test balance for local testing
            if (process.env.NODE_ENV === 'development' && userId) {
                const balRow = await client.query('SELECT balance FROM users WHERE id = $1', [userId]);
                if (balRow.rows[0] && parseFloat(balRow.rows[0].balance) === 0) {
                    await client.query('UPDATE users SET balance = 100 WHERE id = $1', [userId]);
                    console.log(`[Dev] Auto-funded ${normalizedAddress} with $100 USDT`);
                }
            }
        } catch (dbError) {
            console.error('Error with user lookup/creation:', dbError.message);
            // Continue with wallet address as fallback ID
        } finally {
            if (client) client.release();
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

            // Without signature verification, always assign USER role (never admin)
            req.user = {
                id: normalizedAddress,
                address: normalizedAddress,
                role: USER_ROLES.USER
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
