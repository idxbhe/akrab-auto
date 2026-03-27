const bot = require('./src/bot');
const { startChecker } = require('./src/checker');
const logger = require('./src/logger');
const { db, historyDb } = require('./src/db');
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '10000', 10);
const PORT = process.env.PORT || 3300;

// Webhook Regex from docs.html
const RX = /RC=(?<reffid>[a-f0-9-]+)\s+TrxID=(?<trxid>\d+)\s+(?<produk>[A-Z0-9]+)\.(?<tujuan>\d+)\s+(?<status_text>[A-Za-z]+)\s*(?<keterangan>.+?)(?:\s+Saldo[\s\S]*?)?(?:\bresult=(?<status_code>\d+))?\s*>?$/i;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.all('/webhook', (req, res) => {
    try {
        const message = (req.query && req.query.message) || (req.body && req.body.message);

        if (!message) {
            logger.warn('Webhook received but message is empty');
            return res.status(400).send('Message empty');
        }

        logger.info(`Webhook received: ${message}`);

        const match = message.match(RX);
        if (!match || !match.groups) {
            logger.warn(`Webhook format not recognized: ${message}`);
            return res.status(200).send('Format not recognized');
        }

        const { reffid, status_text, status_code: statusCodeRaw } = match.groups;
        const keterangan = (match.groups.keterangan || '').trim();

        let status_code = null;
        if (statusCodeRaw != null) {
            status_code = Number(statusCodeRaw);
        } else {
            if (/sukses/i.test(status_text)) status_code = 0;
            else if (/gagal|batal/i.test(status_text)) status_code = 1;
        }

        const order = db.get('preorders').find({ reff_id: reffid }).value();
        if (order) {
            let finalStatus = 'ERROR';
            if (status_code === 0) {
                finalStatus = 'SUCCESS';
            }

            // Update order status
            db.get('preorders')
                .find({ reff_id: reffid })
                .assign({
                    status: finalStatus,
                    keterangan: keterangan,
                    updated_at: new Date().toISOString()
                })
                .write();

            logger.info(`Order ${order.id} updated via webhook to ${finalStatus}`);

            // Notify Admins
            const adminChatIds = db.get('admin_chats').value() || [];
            const notifyMsg = `🔔 <b>STATUS UPDATE (WEBHOOK)</b> 🔔\n\nID: <code>${order.id}</code>\nNomor: ${order.nomor}\nPaket: ${order.nama_produk}\nStatus: <b>${finalStatus}</b>\nKet: ${keterangan}`;
            
            for (const chatId of adminChatIds) {
                bot.telegram.sendMessage(chatId, notifyMsg, { parse_mode: 'HTML' }).catch(e => logger.error(`Failed to notify admin ${chatId}`, e.message));
            }

            // If success, move to history
            if (finalStatus === 'SUCCESS') {
                const completedOrder = db.get('preorders').find({ reff_id: reffid }).value();
                historyDb.get('history').push(completedOrder).write();
                db.get('preorders').remove({ reff_id: reffid }).write();
                logger.info(`Order ${order.id} moved to history`);
            }
        } else {
            logger.warn(`Order with reff_id ${reffid} not found for webhook update`);
        }

        res.status(200).send('OK');
    } catch (err) {
        logger.error('Error processing webhook', err.message);
        res.status(500).send('Internal Error');
    }
});

app.listen(PORT, () => {
    logger.info(`Webhook server listening on port ${PORT}`);
});

bot.launch().then(() => {
    logger.info('Bot is running...');
    startChecker(bot, CHECK_INTERVAL);
}).catch(err => {
    logger.error('Failed to start bot', err);
});

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
});
