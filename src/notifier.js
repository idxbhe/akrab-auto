const { db, historyDb } = require('./db');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;

/**
 * Format message for Telegram Channel according to specific requirements
 */
function formatMessage(order) {
    const waktu = logger.formatDate(order.updated_at || order.created_at);
    
    let statusEmoji = '';
    let statusKet = '';
    const status = (order.status || '').toUpperCase();

    if (status === 'SUCCESS') {
        statusEmoji = ' ✅';
        statusKet = 'Order selesai.';
    } else if (status === 'ERROR' || status === 'GAGAL') {
        statusEmoji = ' ❌';
        statusKet = `⚠️ ${order.keterangan || 'Gagal'}`;
    } else if (status === 'UNPROCESSED' || status === 'PENDING') {
        statusEmoji = ' 🔄';
        statusKet = 'Menunggu stok.';
    } else if (status === 'EXECUTED') {
        statusEmoji = ' 🛄';
        statusKet = 'Menunggu status transaksi dari web';
    } else {
        statusEmoji = '';
        statusKet = order.keterangan || '-';
    }

    // Alignment: "Nomor  :" is 8 chars, "Paket  :" is 8 chars, "Status :" is 8 chars
    return `💳 ORDER <code>#${order.id}</code>${statusEmoji}\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `<code>Nomor  :</code> <code>${order.nomor}</code>\n` +
           `<code>Paket  :</code> <code>${order.nama_produk}</code>\n\n\n` +
           `<code>Status :</code> <code>${order.status}</code>\n` +
           `\`\`\`\n${statusKet}\n\`\`\`\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `🕒 <code>Update :</code> <code>${waktu}</code>`;
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

/**
 * Delete message from channel when order is deleted
 */
async function deleteChannelMessage(bot, msgId) {
    if (!CHANNEL_ID || !msgId) return;
    try {
        await bot.telegram.deleteMessage(CHANNEL_ID, msgId);
        logger.info(`Channel message ${msgId} deleted because order was removed.`);
    } catch (err) {
        // Just log, maybe message already deleted manually
        logger.warn(`Failed to delete channel message ${msgId}: ${err.message}`);
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

module.exports = { notifyOrderUpdate, deleteChannelMessage };
