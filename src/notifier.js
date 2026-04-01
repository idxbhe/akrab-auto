const { db, historyDb } = require('./db');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const TOPIC_ID = process.env.ADMIN_TOPIC_ID ? Number(process.env.ADMIN_TOPIC_ID) : null;
const API_LOG_TOPIC_ID = process.env.ADMIN_API_LOG_TOPIC_ID ? Number(process.env.ADMIN_API_LOG_TOPIC_ID) : null;

/**
 * Telegram Message Queue to handle rate limits (429)
 */
class TelegramQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.delay = 50; // Base delay between messages in ms
    }

    async push(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const { task, resolve, reject } = this.queue.shift();
            try {
                const result = await task();
                resolve(result);
                await new Promise(r => setTimeout(r, this.delay));
            } catch (err) {
                if (err.response && err.response.error_code === 429) {
                    const retryAfter = (err.response.parameters.retry_after || 1) * 1000;
                    logger.warn(`Telegram Rate Limit (429). Waiting ${retryAfter}ms...`);
                    
                    // Put task back to front
                    this.queue.unshift({ task, resolve, reject });
                    
                    await new Promise(r => setTimeout(r, retryAfter));
                    // Continue loop
                } else {
                    reject(err);
                }
            }
        }

        this.isProcessing = false;
    }
}

const queue = new TelegramQueue();

/**
 * Format message for Telegram Channel using pure HTML tags
 */
function formatMessage(order) {
    const waktu = logger.formatDate(order.updated_at || order.created_at);
    
    let statusEmoji = '';
    let statusKet = '';
    const status = (order.status || '').toUpperCase();

    if (status === 'SUKSES') {
        statusEmoji = ' ✅';
        statusKet = 'Order selesai.';
    } else if (status === 'GAGAL') {
        statusEmoji = ' ❌';
        statusKet = `⚠️ ${order.keterangan || 'Gagal'}`;
    } else if (status === 'UNPROCESSED') {
        statusEmoji = ' 🔄';
        statusKet = 'Menunggu stok.';
    } else if (status === 'PENDING') {
        statusEmoji = ' ⏳';
        statusKet = 'Sedang diproses server...';
    } else if (status === 'EXECUTED') {
        statusEmoji = ' 🛄';
        statusKet = 'Akan segera diproses';
    } else {
        statusEmoji = '';
        statusKet = order.keterangan || '-';
    }

    const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━';

    // Alignment: Using <code> and <pre> for pure HTML formatting
    return `💳 <b>ORDER <code>#${order.id}</code></b>${statusEmoji}\n` +
           `<code>${separator}</code>\n` +
           `<code>Nomor  :</code> <code>${order.nomor}</code>\n` +
           `<code>Paket  :</code> <code>${order.nama_produk}</code>\n\n\n` +
           `<code>Status :</code> <code>${order.status}</code>\n` +
           `<pre>${statusKet}</pre>\n` +
           `<code>${separator}</code>\n` +
           `🕒 <b>Update :</b> <code>${waktu}</code>`;
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

        const extra = { parse_mode: 'HTML' };
        if (TOPIC_ID) {
            extra.message_thread_id = TOPIC_ID;
        }

        if (msgId) {
            try {
                await queue.push(() => bot.telegram.editMessageText(CHANNEL_ID, msgId, null, text, { parse_mode: 'HTML' }));
            } catch (err) {
                if (err.description && (err.description.includes('message to edit not found') || err.description.includes('message can\'t be edited'))) {
                    // Try to send new message to the (potentially new) channel/topic
                    const newMsg = await queue.push(() => bot.telegram.sendMessage(CHANNEL_ID, text, extra));
                    updateMsgId(order.id, newMsg.message_id);
                } else if (err.description && err.description.includes('message is not modified')) {
                    // Ignore
                } else {
                    logger.error(`Failed to edit channel message for ${orderId}`, err.message);
                }
            }
        } else {
            const newMsg = await queue.push(() => bot.telegram.sendMessage(CHANNEL_ID, text, extra));
            updateMsgId(order.id, newMsg.message_id);
        }
    } catch (err) {
        logger.error(`Critical error in notifyOrderUpdate for ${orderId}`, err.message);
    }
}

/**
 * Send API Request Log
 */
async function notifyApiLogRequest(bot, config) {
    if (!CHANNEL_ID || !API_LOG_TOPIC_ID) return null;

    try {
        const waktu = logger.formatDate(new Date().toISOString());
        const params = config.params ? JSON.stringify(config.params, null, 2) : '-';
        
        const text = `🚀 <b>API REQUEST</b>\n` +
                     `<code>${waktu}</code>\n` +
                     `---------------------------\n` +
                     `<b>Method:</b> <code>${(config.method || 'GET').toUpperCase()}</code>\n` +
                     `<b>URL:</b> <code>${config.url}</code>\n` +
                     `<b>Params:</b>\n<pre>${params}</pre>`;

        const msg = await queue.push(() => bot.telegram.sendMessage(CHANNEL_ID, text, {
            parse_mode: 'HTML',
            message_thread_id: API_LOG_TOPIC_ID
        }));
        return msg.message_id;
    } catch (err) {
        logger.error('Failed to send API Request Log', err.message);
        return null;
    }
}

/**
 * Send API Response Log as Reply
 */
async function notifyApiLogResponse(bot, response, requestMsgPromise) {
    if (!CHANNEL_ID || !API_LOG_TOPIC_ID) return;

    try {
        // Wait for request message ID to be available
        const replyToId = await requestMsgPromise;
        if (!replyToId) return;

        const waktu = logger.formatDate(new Date().toISOString());
        const data = response && response.data ? JSON.stringify(response.data, null, 2) : 'No Data';

        const text = `📥 <b>API RESPONSE</b>\n` +
                     `<code>${waktu}</code>\n` +
                     `---------------------------\n` +
                     `<pre>${data}</pre>`;

        await queue.push(() => bot.telegram.sendMessage(CHANNEL_ID, text, {
            parse_mode: 'HTML',
            message_thread_id: API_LOG_TOPIC_ID,
            reply_to_message_id: replyToId
        }));
    } catch (err) {
        logger.error('Failed to send API Response Log', err.message);
    }
}

/**
 * Delete message from channel when order is deleted
 */
async function deleteChannelMessage(bot, msgId) {
    if (!CHANNEL_ID || !msgId) return;
    try {
        await queue.push(() => bot.telegram.deleteMessage(CHANNEL_ID, msgId));
        logger.info(`Channel message ${msgId} deleted because order was removed.`);
    } catch (err) {
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

module.exports = { notifyOrderUpdate, deleteChannelMessage, notifyApiLogRequest, notifyApiLogResponse };
