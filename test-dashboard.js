// Test dashboard metrics directly
require('dotenv').config();
const metricsService = require('./src/services/metricsService');

async function test() {
    console.log('Testing getDashboardSummary...');
    try {
        const summary = await metricsService.getDashboardSummary();
        console.log('SUCCESS:', JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error('ERROR:', error.message);
        console.error('Stack:', error.stack);
    }
    process.exit(0);
}

test();
