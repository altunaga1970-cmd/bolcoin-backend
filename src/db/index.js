/**
 * DB Pool re-export
 *
 * Migrations import from '../../db' expecting the pool.
 * This shim re-exports pool from config/database.
 */
const { pool } = require('../config/database');
module.exports = pool;
