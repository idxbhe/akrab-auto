const { db, historyDb } = require('./db');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;

/**
 * Format message for Telegram Channel
 * Perfectly symmetric, monospace, and polished
 */
function formatMessage(order) {
    const waktu = logger.formatDate(order.updated_at || order.created_at);
    
    let statusEmoji = '';
    const status = (order.status || '').toUpperCase();
    if (status === 'SUCCESS') statusEmoji = ' ✅';
    else if (status === 'ERROR' || status === 'GAGAL') statusEmoji = ' ❌';

    // Labels are exactly 7 characters + ": " = 9 characters total
    // "Nomor  : "
    // "Paket  : "
    // "Status : "
    // "Ket    : "
    
    return `<b>📑 ORDER <code>#${order.id}</code></b>\n` +
           `<code>━━━━━━━━━━━━━━━━━━━━━━</code>\n` +
           `<code>Nomor  : </code><code>${order.nomor}</code>\n` +
           `<code>Paket  : </code><code>${order.nama_produk}</code>\n` +
           `<code>Status : ${order.status}${statusEmoji}</code>\n` +
           `<code>Ket    : ${order.keterangan || '-'}</code>\n` +
           `<code>━━━━━━━━━━━━━━━━━━━━━━</code>\n` +
           `🕒 <b>Update : <code>${waktu}</code></b>`;
}

/**
 * Send or Edit notification in Telegram Channel
 */
async function notifyOrderUpdate(bot, orderId) {
    if (!CHANNEL_ID) return;

    try {
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
                if (err.description && (err.description.includes('message to edit not found') || err.description.includes('message can\'t be edited'))) {
                    const newMsg = await bot.telegram.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
                    updateMsgId(order.id, newMsg.message_id);
                } else if (err.description && err.description.includes('message is not modified')) {
                    // Ignore
                } else {
                    logger.error(`Failed to edit channel message for ${orderId}`, err.message);
                }
            }
        } else {
            const newMsg = await bot.telegram.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
            updateMsgId(order.id, newMsg.message_id);
        }
    } catch (err) {
        logger.error(`Critical error in notifyOrderUpdate for ${orderId}`, err.message);
    }
}

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
