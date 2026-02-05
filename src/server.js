const app = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');
const emailService = require('./services/email.service');
const attendanceController = require('./controllers/attendance.controller');
const axios = require('axios');

const PORT = process.env.PORT || config.port || 5001;

/**
 * PRODUCTION ATTENDANCE INTEGRITY
 * Decouples Attendance Logs from Session Auth.
 * Finalizes any orphaned logs at 4:00 AM daily.
 */
function initBackgroundJobs() {
    logger.info('[SYSTEM] Initializing background check for Attendance Integrity...');

    // Check every hour
    setInterval(() => {
        const now = new Date();
        const currentHour = now.getHours();

        // Trigger at 4:00 AM
        if (currentHour === 4) {
            logger.info('[SYSTEM] 4:00 AM reached. Triggering Auto-Checkout for orphaned logs...');
            attendanceController.performAutoCheckout();
        }
    }, 1000 * 60 * 60);

    // Run once on startup in Dev/Debug mode to verify
    if (config.nodeEnv === 'development') {
        logger.info('[DEV] Running startup check for orphaned attendance logs...');
        attendanceController.performAutoCheckout();
    }
}

/**
 * SELF-PING (Render Free Tier Friendly)
 * - Hits the internal /api/health endpoint every 13 minutes in PRODUCTION.
 * - This is a lightweight, valid health check that exercises the full Express stack.
 * - NOTE: Some platforms only keep services awake for *external* traffic.
 *         Use an external cron/uptime service for guaranteed wake-ups.
 */
function initSelfPing() {
    if (config.nodeEnv !== 'production') {
        logger.info('[SELF-PING] Skipped (non-production environment).');
        return;
    }

    const intervalMs = 13 * 60 * 1000; // 13 minutes
    const url = `http://127.0.0.1:${PORT}/api/health`;

    logger.info(`[SELF-PING] Initializing self-ping to ${url} every ${intervalMs / 60000} minutes...`);

    setInterval(async () => {
        try {
            const startedAt = Date.now();
            const response = await axios.get(url, { timeout: 8000 });
            const duration = Date.now() - startedAt;

            if (response.status === 200) {
                logger.info(`[SELF-PING] OK (${duration}ms) - status: ${response.data.status}, uptime: ${response.data.uptime}`);
            } else {
                logger.warn(`[SELF-PING] Non-200 response: ${response.status}`);
            }
        } catch (err) {
            logger.warn(`[SELF-PING] Failed: ${err.message}`);
        }
    }, intervalMs);
}

/**
 * Start Server - Async wrapper to handle email service initialization
 */
async function startServer() {
    try {
        // Load config and app inside try block to catch validation/loading errors
        const config = require('./config/env');
        const app = require('./app');
        const emailService = require('./services/email.service');

        // Initialize Email Service (non-blocking)
        logger.info('[SYSTEM] Initializing Email Service...');
        try {
            await emailService.initTransporter();
            logger.info('✅ Email Service Ready');
        } catch (emailError) {
            logger.warn(`⚠️ Email Service Failed to Initialize: ${emailError.message}`);
            logger.warn('⚠️ Server will continue without email functionality');
        }

        // Start Server on all network interfaces
        app.listen(PORT, '0.0.0.0', () => {
            logger.info(`🚀 Backend Server Running on Port ${PORT}`);
            logger.info(`🌍 Mode: ${config.nodeEnv}`);
            logger.info(`📡 Health Check: http://localhost:${PORT}/api/health`);

            // Background Jobs Initialization
            initBackgroundJobs();

            // Internal Self-Ping (Render / similar free tiers)
            initSelfPing();
        });
    } catch (error) {
        // CRITICAL: Ensure early errors are logged before exiting
        console.error('❌ CRITICAL STARTUP ERROR:', error.message);
        logger.error(`❌ CRITICAL: Server failed to start: ${error.message}`);
        logger.error(error.stack);
        process.exit(1);
    }
}

// Start the server
startServer();

module.exports = app;