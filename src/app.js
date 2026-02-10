const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { notFound, errorHandler } = require('./middleware/errorHandler');
const { geoBlockMiddleware } = require('./middleware/geoblock');

// Importar rutas
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const drawRoutes = require('./routes/draw');
const betRoutes = require('./routes/bet');
const adminRoutes = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');
const adminDashboardRoutes = require('./routes/adminDashboard');
const adminTransactionsRoutes = require('./routes/adminTransactions');
const adminReferralsRoutes = require('./routes/adminReferrals');
const adminAuditRoutes = require('./routes/adminAudit');
const adminCleanupRoutes = require('./routes/adminCleanup');
const paymentRoutes = require('./routes/payments');
const schedulerRoutes = require('./routes/scheduler');
const claimsRoutes = require('./routes/claims');
const bankrollRoutes = require('./routes/bankroll');
const lotteryRoutes = require('./routes/lottery');
const kenoRoutes = require('./routes/keno');
// MVP: Nuevas rutas
const publicConfigRoutes = require('./routes/publicConfig');
const adminFlagsRoutes = require('./routes/adminFlags');
const adminOpsRoutes = require('./routes/adminOps');
// const userRoutes = require('./routes/user');

// =================================
// CREAR APLICACIÓN EXPRESS
// =================================

const app = express();

// =================================
// MIDDLEWARES GLOBALES
// =================================

// CORS - Permitir solicitudes desde el frontend
// Supports: FRONTEND_URL (single) or ALLOWED_ORIGINS (comma-separated for multiple domains)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, health checks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true
}));

// Helmet - security headers
app.use(helmet());

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting general para /api
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas peticiones. Intenta de nuevo en un minuto.' }
});
app.use('/api', apiLimiter);

// Rate limiting estricto para auth admin
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiados intentos de autenticacion. Intenta de nuevo en 15 minutos.' }
});
app.use('/api/admin/auth/nonce', authLimiter);
app.use('/api/admin/auth/verify', authLimiter);

// Logging de requests en desarrollo
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`, {
            body: req.body,
            query: req.query,
            params: req.params
        });
        next();
    });
}

// =================================
// RUTAS DE SALUD
// =================================

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'La Bolita API',
        version: '1.0.0',
        status: 'running'
    });
});

app.get('/health', (req, res) => {
    const { dbAvailable } = require('./config/database');
    const status = dbAvailable ? 'healthy' : 'degraded';
    res.status(200).json({
        success: true,
        status,
        database: dbAvailable ? 'connected' : 'unavailable',
        timestamp: new Date().toISOString()
    });
});

// =================================
// GEOBLOCKING (Produccion)
// =================================

// Activar geoblocking solo en produccion o cuando ENABLE_GEOBLOCK=true
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_GEOBLOCK === 'true') {
    console.log('[GeoBlock] Geoblocking enabled');
    app.use('/api', geoBlockMiddleware);
}

// =================================
// DEV ROUTES (development only)
// =================================

if (process.env.NODE_ENV === 'development') {
    const { getClient } = require('./config/database');

    // Give test balance to a wallet
    app.post('/api/dev/give-balance', async (req, res) => {
        try {
            const { address, amount = 1000 } = req.body;
            if (!address) {
                return res.status(400).json({ success: false, message: 'Address required' });
            }

            const normalizedAddress = address.toLowerCase();
            const client = await getClient();

            // Check if user exists with this wallet
            let userResult = await client.query(
                'SELECT id, balance FROM users WHERE wallet_address = $1',
                [normalizedAddress]
            );

            if (userResult.rows.length === 0) {
                // Create new user with wallet address
                userResult = await client.query(

                    `INSERT INTO users (username, email, password_hash, balance, wallet_address, created_at, updated_at)
                     VALUES ($1, $2, 'web3-auth', $3, $4, NOW(), NOW())
                     RETURNING id`,
                    [normalizedAddress, `${normalizedAddress}@wallet.local`, amount, normalizedAddress]
                );
                console.log('Created user for wallet:', normalizedAddress, 'with ID:', userResult.rows[0]?.id);
            } else {
                // Update balance
                await client.query(
                    'UPDATE users SET balance = balance + $1 WHERE wallet_address = $2',
                    [amount, normalizedAddress]
                );
            }

            client.release();
            res.json({ success: true, message: `Added ${amount} USDT to ${normalizedAddress}` });
        } catch (error) {
            console.error('Error giving balance:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Debug endpoint to check user status
    app.get('/api/dev/user-status', require('../src/middleware/web3Auth').authenticateWallet, async (req, res) => {
        try {
            const userId = req.user.id;
            const walletAddress = req.user.address;

            const client = await getClient();
            const userResult = await client.query(
                'SELECT id, username, email, balance, wallet_address FROM users WHERE id = $1',
                [userId]
            );
            client.release();

            if (userResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const user = userResult.rows[0];
            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    balance: user.balance,
                    wallet_address: user.wallet_address
                },
                request_wallet: walletAddress,
                match: user.wallet_address?.toLowerCase() === walletAddress?.toLowerCase()
            });
        } catch (error) {
            console.error('Error checking user status:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Debug endpoint to check draws status
    app.get('/api/dev/draws-status', async (req, res) => {
        try {
            const client = await getClient();
            const drawsResult = await client.query(
                'SELECT id, draw_number, draw_type, status, scheduled_time, created_at FROM draws ORDER BY scheduled_time DESC LIMIT 10'
            );

            const now = new Date();
            const draws = drawsResult.rows.map(draw => ({
                ...draw,
                scheduled_time: draw.scheduled_time,
                is_past: draw.scheduled_time <= now,
                time_diff: Math.floor((draw.scheduled_time - now) / 1000 / 60) // minutes
            }));

            client.release();

            res.json({
                success: true,
                now: now.toISOString(),
                draws: draws,
                next_draws: draws.filter(d => d.scheduled_time > now).slice(0, 3)
            });
        } catch (error) {
            console.error('Error checking draws status:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Debug endpoint to create test draws for today
    app.post('/api/dev/create-test-draws', async (req, res) => {
        try {
            const client = await getClient();
            const now = new Date();

            // Crear sorteos para hoy
            const todayDraws = [
                { time: '08:00', type: 'bolita' },
                { time: '12:00', type: 'bolita' },
                { time: '20:00', type: 'bolita' }
            ];

            const created = [];
            for (const draw of todayDraws) {
                const [hours, minutes] = draw.time.split(':').map(Number);
                const scheduledTime = new Date(now);
                scheduledTime.setUTCHours(hours, minutes, 0, 0);

                // Si la hora ya pasó hoy, programar para mañana
                if (scheduledTime <= now) {
                    scheduledTime.setUTCDate(scheduledTime.getUTCDate() + 1);
                }

                const drawNumber = `${scheduledTime.getUTCFullYear()}${(scheduledTime.getUTCMonth()+1).toString().padStart(2,'0')}${scheduledTime.getUTCDate().toString().padStart(2,'0')}-${hours.toString().padStart(2,'0')}${minutes.toString().padStart(2,'0')}-LB`;

                try {
                    const result = await client.query(
                        `INSERT INTO draws (draw_number, draw_type, scheduled_time, status, created_at, updated_at)
                         VALUES ($1, $2, $3, 'open', NOW(), NOW())
                         ON CONFLICT (draw_number) DO NOTHING
                         RETURNING id, draw_number, scheduled_time`,
                        [drawNumber, draw.type, scheduledTime]
                    );

                    if (result.rows.length > 0) {
                        created.push(result.rows[0]);
                    }
                } catch (insertError) {
                    console.log(`Draw ${drawNumber} already exists`);
                }
            }

            client.release();
            res.json({
                success: true,
                message: `Created ${created.length} test draws`,
                draws: created
            });
        } catch (error) {
            console.error('Error creating test draws:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Run migration to add wallet_address column
    app.post('/api/dev/run-migration', async (req, res) => {
        try {
            const client = await getClient();

            // Add wallet_address column if not exists
            await client.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name = 'users' AND column_name = 'wallet_address') THEN
                        ALTER TABLE users ADD COLUMN wallet_address VARCHAR(42) UNIQUE;
                        CREATE INDEX idx_users_wallet_address ON users(wallet_address);
                    END IF;
                END $$
            `);

            // Make username nullable
            await client.query('ALTER TABLE users ALTER COLUMN username DROP NOT NULL');

            client.release();
            res.json({ success: true, message: 'Migration completed' });
        } catch (error) {
            console.error('Migration error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    console.log('[Dev] Development routes enabled: POST /api/dev/give-balance');

    // Debug endpoint to test betting with blockchain
    app.post('/api/dev/test-bet', require('../src/middleware/web3Auth').authenticateWallet, async (req, res) => {
        try {
            const { drawId, betType, numbers, amount } = req.body;
            const userId = req.user.id;

            console.log(`[Test] User ${userId} making test bet: ${betType} ${numbers} for ${amount} USDT in draw ${drawId}`);

            // Usar betService para hacer la apuesta
            const betService = require('./services/betService');
            const result = await betService.placeBets(userId, drawId, [{
                game_type: betType,
                number: numbers,
                amount: amount,
                has_pass: false
            }]);

            res.json({
                success: true,
                message: 'Test bet completed',
                result: result
            });

        } catch (error) {
            console.error('Test bet failed:', error);
            res.status(500).json({ success: false, message: error.message, stack: error.stack });
        }
    });

    // Debug endpoint to test contract interaction
    app.post('/api/dev/test-contract', async (req, res) => {
        try {
            const { address } = req.body;
            if (!address) {
                return res.status(400).json({ success: false, message: 'Address required' });
            }

            const ethers = require('ethers');
            const { getLaBolitaContract } = require('./chain/provider');

            let contract;
            try {
                contract = getLaBolitaContract();
            } catch (chainError) {
                return res.status(503).json({ success: false, message: chainError.message });
            }

            // Probar obtener balance del usuario
            const balance = await contract.userBalances(address);
            console.log(`Contract balance for ${address}: ${ethers.formatUnits(balance, 6)} USDT`);

            // Probar adminDeposit
            console.log(`Testing adminDeposit for ${address}...`);
            const depositTx = await contract.adminDeposit(address, ethers.parseUnits('10', 6));
            await depositTx.wait();
            console.log(`Deposit tx: ${depositTx.hash}`);

            // Verificar nuevo balance
            const newBalance = await contract.userBalances(address);
            console.log(`New balance: ${ethers.formatUnits(newBalance, 6)} USDT`);

            res.json({
                success: true,
                address,
                balanceBefore: ethers.formatUnits(balance, 6),
                balanceAfter: ethers.formatUnits(newBalance, 6),
                depositTx: depositTx.hash
            });

        } catch (error) {
            console.error('Contract test failed:', error);
            res.status(500).json({ success: false, message: error.message, details: error.toString() });
        }
    });
}

// =================================
// RUTAS DE LA API
// =================================

// MVP: Configuracion publica (flags, params de juegos)
app.use('/api/public-config', publicConfigRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/draws', drawRoutes);
app.use('/api/bets', betRoutes);
// IMPORTANTE: adminAuthRoutes debe ir ANTES de adminRoutes
// para que /api/admin/auth/* no sea bloqueado por el middleware de autenticación
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/transactions', adminTransactionsRoutes);
app.use('/api/admin/referrals', adminReferralsRoutes);
app.use('/api/admin/audit', adminAuditRoutes);
app.use('/api/admin/cleanup', adminCleanupRoutes);
app.use('/api/admin/flags', adminFlagsRoutes);
app.use('/api/admin/ops', adminOpsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/claims', claimsRoutes);
app.use('/api/bankroll', bankrollRoutes);
app.use('/api/lottery', lotteryRoutes);
app.use('/api/keno', kenoRoutes);
// app.use('/api/user', userRoutes);

// =================================
// MANEJO DE ERRORES
// =================================

// Ruta no encontrada (404)
app.use(notFound);

// Manejador global de errores
app.use(errorHandler);

// =================================
// EXPORTAR APP
// =================================

module.exports = app;
