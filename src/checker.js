const api = require('./api');
const { db } = require('./db');
const logger = require('./logger');

async function checkAndProcess(bot) {
    try {
        const preorders = db.get('preorders').value();
        
        // Only process UNPROCESSED orders
        const ordersToTrx = preorders.filter(p => p.status === 'UNPROCESSED' || p.status === 'pending');

        if (ordersToTrx.length === 0) return;

        const stockRes = await api.cekStock();
        if (!stockRes || !stockRes.data) {
            logger.warn('Failed to get stock from server');
            return;
        }
        
        const stocks = stockRes.data;

        for (const preorder of ordersToTrx) {
            const productStock = stocks.find(s => s.type === preorder.kode_produk);
            const sisaSlot = productStock ? parseInt(productStock.sisa_slot, 10) : 0;
            
            if (productStock && sisaSlot > 0) {
                logger.info(`Stock found for ${preorder.kode_produk} (Slot: ${sisaSlot}). Executing trx...`, { id: preorder.id });
                
                broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI OTOMATIS</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot: ${sisaSlot}`);

                try {
                    const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                    logger.info(`Trx result for ${preorder.id}`, trxRes);
                    
                    const isFailedTrx = !trxRes || trxRes.ok === false || trxRes.status === false || (trxRes.message && trxRes.message.toLowerCase().includes('gagal'));

                    if (isFailedTrx) {
                        // Keep as UNPROCESSED to retry next cycle if it's a server rejection but stock was supposedly there
                        // Or set to ERROR if it's a definitive failure. 
                        // The todo says status becomes EXECUTED after execution.
                        // Let's stick to the workflow: UNPROCESSED -> EXECUTED.
                        // If the API call itself returns a "failed" message, it's still technically "executed" from our side.
                        
                        db.get('preorders')
                          .find({ id: preorder.id })
                          .assign({
                              status: 'EXECUTED',
                              keterangan: 'Initial Trx Response: ' + JSON.stringify(trxRes),
                              updated_at: new Date().toISOString()
                          })
                          .write();
                          
                        broadcastToAdmins(bot, `⚠️ <b>TRANSAKSI TERKIRIM (RESPON NEGATIF)</b> ⚠️\n\nID: <code>${preorder.id}</code>\nResponse:\n<pre>${JSON.stringify(trxRes, null, 2)}</pre>`);
                    } else {
                        db.get('preorders')
                          .find({ id: preorder.id })
                          .assign({
                              status: 'EXECUTED',
                              keterangan: 'Initial Trx Response: ' + JSON.stringify(trxRes),
                              updated_at: new Date().toISOString()
                          })
                          .write();
                          
                        broadcastToAdmins(bot, `🚀 <b>TRANSAKSI TEREKSEKUSI</b> 🚀\n\nID: <code>${preorder.id}</code>\nNomor: ${preorder.nomor}\nPaket: ${preorder.nama_produk}\nStatus: <b>EXECUTED</b>\n\nMenunggu update dari webhook...`);
                    }

                } catch (error) {
                    logger.error(`Trx failed for ${preorder.id}`, error.message);
                    // If error (e.g. timeout), keep as UNPROCESSED to retry later
                    broadcastToAdmins(bot, `❌ <b>KONEKSI GAGAL SAAT TRANSAKSI</b> ❌\n\nID: <code>${preorder.id}</code>\nError: ${error.message}\n\nStatus tetap <b>UNPROCESSED</b>.`);
                }
            }
        }
        
    } catch (err) {
        logger.error('Checker error', err.message);
    }
}

function broadcastToAdmins(bot, message) {
    const adminChatIds = db.get('admin_chats').value() || [];
    const allowedUsernames = (process.env.AUTHORIZED_USERS || '').toLowerCase().split(',').map(u => u.trim());
    
    // Note: admin_chats already contains IDs of authorized users who started the bot.
    // We filter them by AUTHORIZED_USERS if needed, but currently bot.js adds anyone in the list to admin_chats.
    
    for (const chatId of adminChatIds) {
        bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' }).catch(e => {
            logger.error(`Failed to send message to ${chatId}`, e.message);
        });
    }
}

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Starting checker with interval ${intervalMs}ms`);
    
    async function run() {
        await checkAndProcess(bot);
        setTimeout(run, intervalMs);
    }
    
    run();
}

module.exports = {
    startChecker,
    broadcastToAdmins
};
