-- =================================
-- LA BOLITA - SCHEMA DE BASE DE DATOS
-- =================================

-- Eliminar tablas si existen (para desarrollo)
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS bets CASCADE;
DROP TABLE IF EXISTS draws CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS game_settings CASCADE;

-- =================================
-- TABLA DE USUARIOS
-- =================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    balance DECIMAL(12, 2) DEFAULT 0.00 CHECK (balance >= 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    version INTEGER DEFAULT 0,  -- Para bloqueo optimista
    wallet_address VARCHAR(42) UNIQUE  -- Dirección Ethereum (42 caracteres con 0x)
);

-- Índices para usuarios
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_wallet_address ON users(wallet_address);

-- Comentarios
COMMENT ON TABLE users IS 'Usuarios de la aplicación';
COMMENT ON COLUMN users.version IS 'Versión para bloqueo optimista en actualizaciones de balance';

-- =================================
-- TABLA DE SORTEOS
-- =================================
CREATE TABLE draws (
    id SERIAL PRIMARY KEY,
    draw_number VARCHAR(50) UNIQUE NOT NULL,  -- ej: "2026-01-13-AM", "2026-01-13-PM"
    draw_type VARCHAR(20) DEFAULT 'bolita' CHECK (draw_type IN ('bolita', 'lottery')),  -- Tipo de sorteo
    scheduled_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'closed', 'completed', 'cancelled')),
    winning_number CHAR(4),  -- Número ganador de 4 dígitos (ej: '0123')
    result_entered_at TIMESTAMP,
    result_entered_by INTEGER REFERENCES users(id),
    total_bets_amount DECIMAL(12, 2) DEFAULT 0.00,
    total_payouts_amount DECIMAL(12, 2) DEFAULT 0.00,
    bets_count INTEGER DEFAULT 0,
    winners_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para sorteos
CREATE INDEX idx_draws_scheduled_time ON draws(scheduled_time);
CREATE INDEX idx_draws_status ON draws(status);
CREATE INDEX idx_draws_draw_number ON draws(draw_number);

-- Comentarios
COMMENT ON TABLE draws IS 'Sorteos de la lotería';
COMMENT ON COLUMN draws.status IS 'scheduled: programado, open: abierto para apuestas, closed: cerrado, completed: completado con resultados, cancelled: cancelado';

-- =================================
-- TABLA DE APUESTAS
-- =================================
CREATE TABLE bets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
    game_type VARCHAR(20) NOT NULL CHECK (game_type IN ('fijos', 'centenas', 'parles', 'corrido')),
    bet_number VARCHAR(4) NOT NULL,  -- Almacenar como string para preservar ceros iniciales
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0 AND amount <= 1000),
    potential_payout DECIMAL(12, 2) NOT NULL,
    multiplier INTEGER NOT NULL,  -- 80, 500, o 900
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'cancelled', 'refunded')),
    actual_payout DECIMAL(12, 2) DEFAULT 0.00,
    parent_bet_id INTEGER REFERENCES bets(id),  -- Para apuestas Corrido (enlaza hijos Fijos al padre)
    is_corrido_child BOOLEAN DEFAULT false,  -- True si es una apuesta Fijos creada desde Corrido
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- Índices para apuestas
CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_draw_id ON bets(draw_id);
CREATE INDEX idx_bets_status ON bets(status);
CREATE INDEX idx_bets_game_type ON bets(game_type);
CREATE INDEX idx_bets_created_at ON bets(created_at DESC);
CREATE INDEX idx_bets_parent_bet ON bets(parent_bet_id);

-- Índice compuesto para consultas de historial de usuario
CREATE INDEX idx_bets_user_status_created ON bets(user_id, status, created_at DESC);

-- Comentarios
COMMENT ON TABLE bets IS 'Apuestas de usuarios en sorteos';
COMMENT ON COLUMN bets.game_type IS 'fijos: 2 dígitos, centenas: 3 dígitos, parles: 4 dígitos, corrido: padre para 2 apuestas fijos';
COMMENT ON COLUMN bets.parent_bet_id IS 'Para Corrido: enlaza las apuestas fijos hijas a la apuesta corrido padre';

-- =================================
-- TABLA DE TRANSACCIONES (Auditoría)
-- =================================
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('recharge', 'bet', 'win', 'refund', 'adjustment')),
    amount DECIMAL(12, 2) NOT NULL,  -- Positivo para créditos, negativo para débitos
    balance_before DECIMAL(12, 2) NOT NULL,
    balance_after DECIMAL(12, 2) NOT NULL,
    reference_type VARCHAR(20),  -- 'bet', 'draw', etc.
    reference_id INTEGER,  -- ID del registro relacionado
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para transacciones
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_reference ON transactions(reference_type, reference_id);

-- Comentarios
COMMENT ON TABLE transactions IS 'Registro de auditoría de todas las transacciones';
COMMENT ON COLUMN transactions.amount IS 'Positivo para créditos (recarga, ganancias), negativo para débitos (apuestas)';

-- =================================
-- TABLA DE CONFIGURACIÓN DEL JUEGO
-- =================================
CREATE TABLE game_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

-- Insertar configuraciones por defecto
INSERT INTO game_settings (setting_key, setting_value, description) VALUES
    ('fijos_multiplier', '80', 'Multiplicador de pago para Fijos (2 dígitos)'),
    ('centenas_multiplier', '500', 'Multiplicador de pago para Centenas (3 dígitos)'),
    ('parles_multiplier', '900', 'Multiplicador de pago para Parles (4 dígitos)'),
    ('max_bet_amount', '1000', 'Cantidad máxima de apuesta por número en USDT'),
    ('min_bet_amount', '1', 'Cantidad mínima de apuesta en USDT'),
    ('betting_enabled', 'true', 'Interruptor global de apuestas activado/desactivado');

-- =================================
-- TRIGGERS
-- =================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a la tabla users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Aplicar trigger a la tabla draws
CREATE TRIGGER update_draws_updated_at
    BEFORE UPDATE ON draws
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =================================
-- VISTAS (para conveniencia)
-- =================================

-- Sorteos activos en los que los usuarios pueden apostar
CREATE VIEW active_draws AS
SELECT * FROM draws
WHERE status IN ('scheduled', 'open')
    AND scheduled_time > CURRENT_TIMESTAMP
ORDER BY scheduled_time ASC;

COMMENT ON VIEW active_draws IS 'Sorteos activos disponibles para apuestas';

-- Estadísticas de usuario
CREATE VIEW user_stats AS
SELECT
    u.id,
    u.username,
    u.balance,
    COUNT(DISTINCT b.id) as total_bets,
    COALESCE(SUM(CASE WHEN b.status = 'pending' THEN b.amount ELSE 0 END), 0) as pending_amount,
    COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.actual_payout ELSE 0 END), 0) as total_winnings,
    COALESCE(SUM(CASE WHEN b.status IN ('won', 'lost') THEN b.amount ELSE 0 END), 0) as total_wagered
FROM users u
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.username, u.balance;

COMMENT ON VIEW user_stats IS 'Estadísticas resumidas de cada usuario';

-- =================================
-- DATOS INICIALES
-- =================================

-- Insertar usuario administrador por defecto
-- Contraseña: admin123 (hashed con bcrypt)
INSERT INTO users (username, email, password_hash, role, balance) VALUES
    ('admin', 'admin@labolita.com', '$2a$10$YourHashedPasswordHere', 'admin', 0.00);

-- Nota: La contraseña hasheada debe ser generada con bcrypt al inicializar la aplicación

-- =================================
-- FUNCIONES ÚTILES
-- =================================

-- Función para obtener el número ganador de Fijos (últimos 2 dígitos)
CREATE OR REPLACE FUNCTION get_fijos_winner(winning_number CHAR(4))
RETURNS CHAR(2) AS $$
BEGIN
    RETURN SUBSTRING(winning_number FROM 3 FOR 2);
END;
$$ LANGUAGE plpgsql;

-- Función para obtener el número ganador de Centenas (últimos 3 dígitos)
CREATE OR REPLACE FUNCTION get_centenas_winner(winning_number CHAR(4))
RETURNS CHAR(3) AS $$
BEGIN
    RETURN SUBSTRING(winning_number FROM 2 FOR 3);
END;
$$ LANGUAGE plpgsql;

-- =================================
-- PERMISOS (opcional, ajustar según necesidad)
-- =================================

-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labolita_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labolita_user;

-- =================================
-- FIN DEL SCHEMA
-- =================================

-- Verificar creación de tablas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
