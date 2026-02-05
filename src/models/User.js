const { query, getClient } = require('../config/database');
const bcrypt = require('bcryptjs');
const { BCRYPT_CONFIG, USER_ROLES } = require('../config/constants');

// =================================
// MODELO DE USUARIO
// =================================

class User {
    /**
     * Crear un nuevo usuario
     */
    static async create({ username, email, password, role = USER_ROLES.USER }) {
        // Hash de la contraseña
        const password_hash = await bcrypt.hash(password, BCRYPT_CONFIG.SALT_ROUNDS);

        const text = `
            INSERT INTO users (username, email, password_hash, role, balance)
            VALUES ($1, $2, $3, $4, 0.00)
            RETURNING id, username, email, role, balance, is_active, created_at
        `;
        const values = [username, email, password_hash, role];

        try {
            const result = await query(text, values);
            return result.rows[0];
        } catch (error) {
            // Manejar errores de duplicados
            if (error.code === '23505') {  // unique_violation
                if (error.constraint === 'users_username_key') {
                    throw new Error('El nombre de usuario ya existe');
                } else if (error.constraint === 'users_email_key') {
                    throw new Error('El correo electrónico ya está registrado');
                }
            }
            throw error;
        }
    }

    /**
     * Buscar usuario por ID
     */
    static async findById(id) {
        const text = 'SELECT id, username, email, role, balance, is_active, created_at, updated_at, last_login, version FROM users WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0] || null;
    }

    /**
     * Buscar usuario por username
     */
    static async findByUsername(username) {
        const text = 'SELECT * FROM users WHERE username = $1';
        const result = await query(text, [username]);
        return result.rows[0] || null;
    }

    /**
     * Buscar usuario por email
     */
    static async findByEmail(email) {
        const text = 'SELECT * FROM users WHERE email = $1';
        const result = await query(text, [email]);
        return result.rows[0] || null;
    }

    /**
     * Verificar contraseña
     */
    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Actualizar último login
     */
    static async updateLastLogin(id) {
        const text = 'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1';
        await query(text, [id]);
    }

    /**
     * Obtener balance del usuario
     */
    static async getBalance(id) {
        const text = 'SELECT balance FROM users WHERE id = $1';
        const result = await query(text, [id]);
        return result.rows[0]?.balance || 0;
    }

    /**
     * Incrementar balance (para ganancias o recargas)
     * Usa bloqueo optimista con version
     */
    static async incrementBalance(id, amount) {
        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Bloquear fila del usuario
            const userResult = await client.query(
                'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
                [id]
            );

            if (userResult.rows.length === 0) {
                throw new Error('Usuario no encontrado');
            }

            const user = userResult.rows[0];
            const newBalance = parseFloat(user.balance) + parseFloat(amount);
            const newVersion = user.version + 1;

            // Actualizar balance y versión
            const updateResult = await client.query(
                'UPDATE users SET balance = $1, version = $2 WHERE id = $3 AND version = $4 RETURNING balance',
                [newBalance, newVersion, id, user.version]
            );

            if (updateResult.rows.length === 0) {
                throw new Error('Conflicto de concurrencia - por favor intente de nuevo');
            }

            await client.query('COMMIT');
            return updateResult.rows[0].balance;

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Decrementar balance (para apuestas)
     * Usa bloqueo optimista con version
     */
    static async decrementBalance(id, amount) {
        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Bloquear fila del usuario
            const userResult = await client.query(
                'SELECT id, balance, version FROM users WHERE id = $1 FOR UPDATE',
                [id]
            );

            if (userResult.rows.length === 0) {
                throw new Error('Usuario no encontrado');
            }

            const user = userResult.rows[0];
            const newBalance = parseFloat(user.balance) - parseFloat(amount);

            // Verificar que el balance no sea negativo
            if (newBalance < 0) {
                throw new Error('Balance insuficiente');
            }

            const newVersion = user.version + 1;

            // Actualizar balance y versión
            const updateResult = await client.query(
                'UPDATE users SET balance = $1, version = $2 WHERE id = $3 AND version = $4 RETURNING balance',
                [newBalance, newVersion, id, user.version]
            );

            if (updateResult.rows.length === 0) {
                throw new Error('Conflicto de concurrencia - por favor intente de nuevo');
            }

            await client.query('COMMIT');
            return updateResult.rows[0].balance;

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Actualizar usuario
     */
    static async update(id, updates) {
        const allowedFields = ['email', 'is_active'];
        const fields = [];
        const values = [];
        let paramIndex = 1;

        // Construir query dinámicamente según los campos a actualizar
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }

        if (fields.length === 0) {
            throw new Error('No hay campos para actualizar');
        }

        values.push(id);
        const text = `
            UPDATE users
            SET ${fields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, username, email, role, balance, is_active, updated_at
        `;

        const result = await query(text, values);
        return result.rows[0];
    }

    /**
     * Cambiar contraseña
     */
    static async changePassword(id, newPassword) {
        const password_hash = await bcrypt.hash(newPassword, BCRYPT_CONFIG.SALT_ROUNDS);
        const text = 'UPDATE users SET password_hash = $1 WHERE id = $2';
        await query(text, [password_hash, id]);
    }

    /**
     * Eliminar usuario (soft delete)
     */
    static async delete(id) {
        const text = 'UPDATE users SET is_active = false WHERE id = $1';
        await query(text, [id]);
    }

    /**
     * Listar todos los usuarios (para admin)
     */
    static async findAll({ page = 1, limit = 50, search = '', role = null }) {
        let text = `
            SELECT id, username, email, role, balance, is_active, created_at, last_login
            FROM users
            WHERE 1=1
        `;
        const values = [];
        let paramIndex = 1;

        // Filtro de búsqueda
        if (search) {
            text += ` AND (username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
            values.push(`%${search}%`);
            paramIndex++;
        }

        // Filtro de rol
        if (role) {
            text += ` AND role = $${paramIndex}`;
            values.push(role);
            paramIndex++;
        }

        // Paginación
        const offset = (page - 1) * limit;
        text += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await query(text, values);

        // Contar total de usuarios
        let countText = 'SELECT COUNT(*) FROM users WHERE 1=1';
        const countValues = [];
        let countParamIndex = 1;

        if (search) {
            countText += ` AND (username ILIKE $${countParamIndex} OR email ILIKE $${countParamIndex})`;
            countValues.push(`%${search}%`);
            countParamIndex++;
        }

        if (role) {
            countText += ` AND role = $${countParamIndex}`;
            countValues.push(role);
        }

        const countResult = await query(countText, countValues);
        const total = parseInt(countResult.rows[0].count);

        return {
            users: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtener estadísticas del usuario
     */
    static async getStats(userId) {
        const text = `
            SELECT * FROM user_stats WHERE id = $1
        `;
        const result = await query(text, [userId]);
        return result.rows[0] || null;
    }
}

module.exports = User;
