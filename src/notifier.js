const { db, historyDb } = require('./db');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;

/**
 * Format message for Telegram Channel
 * Symmetric, uses consistent emojis and code blocks
 */
function formatMessage(order) {
    const waktu = logger.formatDate(order.updated_at || order.created_at);
    
    // Symmetric design with decorative lines
    return `<b>📦 ORDER #${order.id}</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━━━\n` +
           `👤 <b>Nomor</b>  : <code>${order.nomor}</code>\n` +
           `🎁 <b>Paket</b>  : <code>${order.nama_produk}</code>\n` +
           `🏷️ <b>Reff</b>   : <code>${order.reff_id || '-'}</code>\n` +
           `━━━━━━━━━━━━━━━━━━━━━━\n` +
           `🔄 <b>Status</b> : <code>${order.status}</code>\n` +
           `📝 <b>Ket</b>    : <code>${order.keterangan || '-'}</code>\n` +
           `━━━━━━━━━━━━━━━━━━━━━━\n` +
           `🕒 <b>Update</b> : <code>${waktu}</code>`;
}

/**
 * Send or Edit notification in Telegram Channel
 * Best-effort logic that doesn't block the main process
 */
async function notifyOrderUpdate(bot, orderId) {
    if (!CHANNEL_ID) return;

    try {
        // Find order in active DB or history DB
        let order = db.get('preorders').find({ id: orderId }).value();
        if (!order) {
            order = historyDb.get('history').find({ id: orderId }).value();
        }

        if (!order) return;

        const text = formatMessage(order);
        const msgId = order.channel_msg_id;

        if (msgId) {
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, msgId, null, text, { parse_mode: 'HTML' });
            } catch (err) {
                // If message not found or deleted, send a new one
                if (err.description && (err.description.includes('message to edit not found') || err.description.includes('message can\'t be edited'))) {
                    const newMsg = await bot.telegram.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
                    updateMsgId(order.id, newMsg.message_id);
                } else if (err.description && err.description.includes('message is not modified')) {
                    // Ignore if content is identical
                } else {
                    logger.error(`Failed to edit channel message for ${orderId}`, err.message);
                }
            }
        } else {
            // First time notification
            const newMsg = await bot.telegram.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
            updateMsgId(order.id, newMsg.message_id);
        }
    } catch (err) {
        logger.error(`Critical error in notifyOrderUpdate for ${orderId}`, err.message);
    }
}

/**
 * Update message ID in the database (active or history)
 */
function updateMsgId(orderId, msgId) {
    const inActive = db.get('preorders').find({ id: orderId }).value();
    if (inActive) {
        db.get('preorders').find({ id: orderId }).assign({ channel_msg_id: msgId }).write();
    } else {
        const inHistory = historyDb.get('history').find({ id: orderId }).value();
        if (inHistory) {
            historyDb.get('history').find({ id: orderId }).assign({ channel_msg_id: msgId }).write();
        }
    }
}

module.exports = { notifyOrderUpdate };
