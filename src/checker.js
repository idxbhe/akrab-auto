const api = require('./api');
const db = require('./db');
const logger = require('./logger');

// We will export a class or function to be called periodically
async function checkAndProcess(bot) {
    try {
        const preorders = db.get('preorders')
            .filter(p => p.status === 'pending' || p.status === 'retrying')
            .value();
            
        if (preorders.length === 0) return;

        const stockRes = await api.cekStock();
        if (!stockRes || !stockRes.data) return;
        
        const stocks = stockRes.data;

        for (const preorder of preorders) {
            const productStock = stocks.find(s => s.type === preorder.kode_produk);
            
            if (productStock && productStock.sisa_slot > 0) {
                logger.info(`Stock found for ${preorder.kode_produk}. Executing trx...`, preorder);
                
                // Broadcast to admins
                broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot di server: ${productStock.sisa_slot}`);

                try {
                    const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                    logger.info(`Trx result for ${preorder.id}`, trxRes);
                    
                    // We assume trxRes has some indication of success or pending.
                    // For now, set status to processing, so we check history next time
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'retrying',
                          keterangan: JSON.stringify(trxRes),
                          updated_at: new Date().toISOString()
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `✅ <b>TRANSAKSI TERKIRIM</b> ✅\n\nID: <code>${preorder.id}</code>\nResponse:\n<pre>${JSON.stringify(trxRes, null, 2)}</pre>\n\nStatus diubah ke <b>retrying</b>.`);

                } catch (error) {
                    logger.error(`Trx failed for ${preorder.id}`, error.message);
                    
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'retrying',
                          keterangan: error.message,
                          updated_at: new Date().toISOString()
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `❌ <b>TRANSAKSI GAGAL/ERROR</b> ❌\n\nID: <code>${preorder.id}</code>\nError: ${error.message}\n\nAkan masuk ke status <b>retrying</b> untuk mencoba lagi di siklus berikutnya.`);
                }
            }
        }
        
        // Also check history for 'retrying'
        const processingOrders = db.get('preorders').filter({ status: 'retrying' }).value();
        for (const p of processingOrders) {
            try {
                const historyRes = await api.cekHistory(p.reff_id);
                logger.info(`History for ${p.id}`, historyRes);
                // Based on historyRes, we should update status to success, error, or keep processing.
                // Because we don't know the exact format, we will just log it and maybe broadcast if it changed.
                // Let's look for "sukses" or "gagal" in the response stringified
                const historyStr = JSON.stringify(historyRes).toLowerCase();
                if (historyStr.includes('sukses') || historyStr.includes('success')) {
                    db.get('preorders').find({ id: p.id }).assign({ status: 'success', updated_at: new Date().toISOString() }).write();
                    broadcastToAdmins(bot, `🎉 <b>TRANSAKSI SUKSES</b> 🎉\n\nID: <code>${p.id}</code>\nNomor: ${p.nomor}\nPaket: ${p.nama_produk}`);
                } else if (historyStr.includes('gagal') || historyStr.includes('failed') || historyStr.includes('batal')) {
                    db.get('preorders').find({ id: p.id }).assign({ status: 'retrying', updated_at: new Date().toISOString() }).write();
                    broadcastToAdmins(bot, `⚠️ <b>TRANSAKSI GAGAL/BATAL</b> ⚠️\n\nID: <code>${p.id}</code>\nStatus diubah ke <b>retrying</b>.`);
                }
            } catch (err) {
                 logger.error(`History check failed for ${p.id}`, err.message);
            }
        }
        
    } catch (err) {
        logger.error('Checker error', err.message);
    }
}

function broadcastToAdmins(bot, message) {
    const adminChatIds = db.get('admin_chats').value() || [];
    for (const chatId of adminChatIds) {
        bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' }).catch(e => {
            logger.error(`Failed to send message to ${chatId}`, e.message);
        });
    }
}

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Starting checker with interval ${intervalMs}ms`);
    setInterval(() => {
        checkAndProcess(bot);
    }, intervalMs);
}

module.exports = {
    startChecker
};
