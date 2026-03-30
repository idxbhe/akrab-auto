const { db, historyDb } = require('./db');
const { notifyOrderUpdate, deleteChannelMessage } = require('./notifier');
const logger = require('./logger');

/**
 * DB Observer - Zero-Touch Logic
 * Monitors database for changes and triggers notifications or deletions
 */
module.exports = (bot) => {
    // Memory cache to track last known state
    // Store: orderId -> { status, updatedAt, msgId }
    const orderCache = new Map();
    
    const INTERVAL = 3000;
    const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;

    if (!CHANNEL_ID) {
        logger.info('Observer: ADMIN_CHANNEL_ID not set. Observer disabled.');
        return;
    }

    logger.info(`Observer: Starting DB observer (interval: ${INTERVAL}ms)...`);

    async function check() {
        try {
            const preorders = db.get('preorders').value() || [];
            // Limit history check to last 50 entries to save resources
            const history = historyDb.get('history').takeRight(50).value() || [];
            const currentOrders = [...preorders, ...history];
            
            const currentOrderIds = new Set();

            // 1. Check for new or updated orders
            for (const order of currentOrders) {
                currentOrderIds.add(order.id);
                
                const cacheKey = order.id;
                const currentStatus = order.status;
                const currentUpdatedAt = order.updated_at || order.created_at;
                const currentMsgId = order.channel_msg_id;
                
                const cached = orderCache.get(cacheKey);

                if (!cached || cached.status !== currentStatus || cached.updatedAt !== currentUpdatedAt || cached.msgId !== currentMsgId) {
                    
                    // Skip notification for very old history orders on startup to avoid spam
                    const isNewOrRecent = !cached || (Date.now() - new Date(currentUpdatedAt).getTime() < 60000);
                    
                    if (isNewOrRecent) {
                        logger.debug(`Observer: Order ${order.id} update detected. Notifying channel...`);
                        await notifyOrderUpdate(bot, order.id);
                    }

                    // Refresh cache with latest data from DB (including potential new msgId)
                    const updatedOrder = [...db.get('preorders').value(), ...historyDb.get('history').value()].find(o => o.id === order.id);
                    
                    orderCache.set(cacheKey, {
                        status: currentStatus,
                        updatedAt: currentUpdatedAt,
                        msgId: updatedOrder ? updatedOrder.channel_msg_id : currentMsgId
                    });
                }
            }

            // 2. Check for deleted orders
            for (const [cachedId, cachedData] of orderCache.entries()) {
                if (!currentOrderIds.has(cachedId)) {
                    logger.info(`Observer: Order ${cachedId} was deleted from database.`);
                    
                    // If it had a channel message, delete it
                    if (cachedData.msgId) {
                        logger.info(`Observer: Deleting channel message ${cachedData.msgId} for deleted order ${cachedId}`);
                        await deleteChannelMessage(bot, cachedData.msgId);
                    }
                    
                    // Remove from cache
                    orderCache.delete(cachedId);
                }
            }
            
        } catch (err) {
            logger.error('Observer: Error in check cycle', err.message);
        } finally {
            setTimeout(check, INTERVAL);
        }
    }

    check();
};
