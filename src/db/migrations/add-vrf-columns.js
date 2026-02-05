/**
 * Migration: Add VRF columns to draws table
 */
const { getClient } = require('../../config/database');

async function up() {
    const client = await getClient();

    try {
        console.log('Adding VRF columns to draws table...');

        // Add vrf_request_id column
        await client.query(`
            ALTER TABLE draws
            ADD COLUMN IF NOT EXISTS vrf_request_id VARCHAR(255)
        `);
        console.log('  - Added vrf_request_id');

        // Add vrf_requested_at column
        await client.query(`
            ALTER TABLE draws
            ADD COLUMN IF NOT EXISTS vrf_requested_at TIMESTAMP
        `);
        console.log('  - Added vrf_requested_at');

        // Add vrf_fulfilled_at column
        await client.query(`
            ALTER TABLE draws
            ADD COLUMN IF NOT EXISTS vrf_fulfilled_at TIMESTAMP
        `);
        console.log('  - Added vrf_fulfilled_at');

        // Add vrf_random_number column
        await client.query(`
            ALTER TABLE draws
            ADD COLUMN IF NOT EXISTS vrf_random_number VARCHAR(255)
        `);
        console.log('  - Added vrf_random_number');

        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run migration if called directly
if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

    up()
        .then(() => {
            console.log('Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error:', error);
            process.exit(1);
        });
}

module.exports = { up };
