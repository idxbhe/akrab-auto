const { db, historyDb } = require('./db');
const { notifyOrderUpdate } = require('./notifier');
const logger = require('./logger');

/**
 * DB Observer - Zero-Touch Logic
 * Monitors database for changes and triggers notifications
 */
module.exports = (bot) => {
    // Memory cache to track last known status and timestamp
    const statusCache = new Map();
    
    // Check interval (every 3 seconds)
    const INTERVAL = 3000;
    const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;

    if (!CHANNEL_ID) {
        logger.info('Observer: ADMIN_CHANNEL_ID not set. Observer disabled.');
        return;
    }

    logger.info(`Observer: Starting DB observer (interval: ${INTERVAL}ms)...`);

    async function check() {
        try {
            // Check active preorders
            const preorders = db.get('preorders').value() || [];
            const history = historyDb.get('history').value() || [];
            const allOrders = [...preorders, ...history];

            for (const order of allOrders) {
                const cacheKey = order.id;
                const currentStatus = order.status;
                const currentUpdatedAt = order.updated_at || order.created_at;
                
                const cached = statusCache.get(cacheKey);

                // If new order OR status changed OR timestamp updated
                if (!cached || cached.status !== currentStatus || cached.updatedAt !== currentUpdatedAt) {
                    
                    // Skip notification for very old history orders on startup
                    const isNewOrRecent = !cached || (Date.now() - new Date(currentUpdatedAt).getTime() < 60000);
                    
                    if (isNewOrRecent) {
                        logger.debug(`Observer: Order ${order.id} status changed to ${currentStatus}. Notifying channel...`);
                        await notifyOrderUpdate(bot, order.id);
                    }

                    // Update cache
                    statusCache.set(cacheKey, {
                        status: currentStatus,
                        updatedAt: currentUpdatedAt
                    });
                }
            }
        } catch (err) {
            logger.error('Observer: Error in check cycle', err.message);
        } finally {
            setTimeout(check, INTERVAL);
        }
    }

    // Start the loop
    check();
};
