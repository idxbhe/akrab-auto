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
                const isActiveStatus = ['UNPROCESSED', 'PENDING', 'EXECUTED'].includes((currentStatus || '').toUpperCase());
                const isChanged = cached && (cached.status !== currentStatus || cached.updatedAt !== currentUpdatedAt || cached.msgId !== currentMsgId);

                // TRIGGER NOTIFICATION
                // Case A: First discovery (startup/migration) AND it's an active order
                // Case B: Already tracked order AND something changed (progress update)
                if ((!cached && isActiveStatus) || isChanged) {
                    logger.debug(`Observer: Triggering notification for order ${order.id} (${currentStatus})`);
                    await notifyOrderUpdate(bot, order.id);
                }

                // UPDATE CACHE
                // Update cache if first time seen or if data changed, to keep it in sync
                if (!cached || isChanged) {
                    // Re-fetch latest data to get potentially updated channel_msg_id from notifyOrderUpdate
                    const latestOrder = [...db.get('preorders').value(), ...history].find(o => o.id === order.id);
                    
                    orderCache.set(cacheKey, {
                        status: currentStatus,
                        updatedAt: currentUpdatedAt,
                        msgId: latestOrder ? latestOrder.channel_msg_id : currentMsgId
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
