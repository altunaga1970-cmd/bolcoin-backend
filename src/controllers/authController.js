const User = require('../models/User');
const { generateToken } = require('../config/auth');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../config/constants');

// =================================
// CONTROLADOR DE AUTENTICACIÓN
// =================================

/**
 * Registrar nuevo usuario
 * POST /api/auth/register
 */
async function register(req, res) {
    try {
        const { username, email, password } = req.body;

        // Validar que todos los campos estén presentes
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Formato de email inválido'
            });
        }

        // Validar longitud de contraseña
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        // Validar longitud de username
        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'El nombre de usuario debe tener al menos 3 caracteres'
            });
        }

        // Crear usuario
        const user = await User.create({ username, email, password });

        // Generar token
        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.REGISTER_SUCCESS,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    balance: user.balance
                },
                token
            }
        });

    } catch (error) {
        console.error('Error en registro:', error);

        // Manejar errores específicos
        if (error.message.includes('ya existe') || error.message.includes('ya está registrado')) {
            return res.status(409).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Iniciar sesión
 * POST /api/auth/login
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;

        // Validar que todos los campos estén presentes
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Usuario y contraseña son requeridos'
            });
        }

        // Buscar usuario
        const user = await User.findByUsername(username);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        // Verificar si el usuario está activo
        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'Usuario desactivado'
            });
        }

        // Verificar contraseña
        const isValidPassword = await User.verifyPassword(password, user.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS
            });
        }

        // Actualizar último login
        await User.updateLastLogin(user.id);

        // Generar token
        const token = generateToken(user);

        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    balance: user.balance
                },
                token
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Obtener usuario actual
 * GET /api/auth/me
 */
async function getMe(req, res) {
    try {
        // El usuario ya está en req.user gracias al middleware de autenticación
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    balance: user.balance,
                    created_at: user.created_at,
                    last_login: user.last_login
                }
            }
        });

    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
}

/**
 * Cerrar sesión
 * POST /api/auth/logout
 */
async function logout(req, res) {
    // En una implementación con JWT sin estado, el logout se maneja en el cliente
    // eliminando el token. Aquí solo enviamos una respuesta de confirmación.
    // En una implementación más avanzada, podrías agregar el token a una lista negra.

    res.json({
        success: true,
        message: 'Sesión cerrada exitosamente'
    });
}

module.exports = {
    register,
    login,
    getMe,
    logout
};
