// Database connection pool - re-export from config to avoid duplicate pools
const { pool } = require('./config/database');

module.exports = pool;
