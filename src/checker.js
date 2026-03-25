const api = require('./api');
const db = require('./db');
const logger = require('./logger');

async function checkAndProcess(bot) {
    try {
        const preorders = db.get('preorders').value();
        
        // 1. Process history for 'retrying' orders
        const retryingOrders = preorders.filter(p => p.status === 'retrying');
        for (const p of retryingOrders) {
            try {
                const historyRes = await api.cekHistory(p.reff_id);
                logger.info(`History for ${p.id}`, historyRes);
                
                const historyStr = JSON.stringify(historyRes).toLowerCase();
                
                // Cek status berdasarkan respon Khfy
                if (historyStr.includes('sukses') || historyStr.includes('success')) {
                    db.get('preorders').find({ id: p.id }).assign({ status: 'succes', updated_at: new Date().toISOString() }).write();
                    broadcastToAdmins(bot, `🎉 <b>TRANSAKSI SUKSES</b> 🎉\n\nID: <code>${p.id}</code>\nNomor: ${p.nomor}\nPaket: ${p.nama_produk}`);
                    p.status = 'succes'; // update lokal agar tidak diproses lanjut
                } else if (historyStr.includes('gagal') || historyStr.includes('failed') || historyStr.includes('batal')) {
                    // Transaksi gagal dari sisi server, kita akan retry (menunggu stock)
                    // Status tetap 'retrying', tapi kita beri flag agar bisa di eksekusi ulang
                    p.needsTrx = true;
                    broadcastToAdmins(bot, `⚠️ <b>TRANSAKSI GAGAL/BATAL DARI SERVER</b> ⚠️\n\nID: <code>${p.id}</code>\nStatus tetap <b>retrying</b> (akan diulang saat stok tersedia tanpa duplikasi)`);
                } else {
                    // Jika proses/pending atau status tidak dikenali, biarkan saja (jangan retry trx)
                    p.isProcessing = true;
                }
            } catch (err) {
                 logger.error(`History check failed for ${p.id}`, err.message);
                 p.isProcessing = true;
            }
        }

        // 2. Process stock and trx for 'pending' AND ('retrying' yang butuh re-trx)
        const ordersToTrx = preorders.filter(p => 
            p.status === 'pending' || (p.status === 'retrying' && p.needsTrx)
        );

        if (ordersToTrx.length === 0) return;

        const stockRes = await api.cekStock();
        if (!stockRes || !stockRes.data) return;
        
        const stocks = stockRes.data;

        for (const preorder of ordersToTrx) {
            const productStock = stocks.find(s => s.type === preorder.kode_produk);
            
            if (productStock && productStock.sisa_slot > 0) {
                logger.info(`Stock found for ${preorder.kode_produk}. Executing trx...`, preorder);
                
                broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot di server: ${productStock.sisa_slot}`);

                try {
                    const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                    logger.info(`Trx result for ${preorder.id}`, trxRes);
                    
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'retrying',
                          keterangan: JSON.stringify(trxRes),
                          updated_at: new Date().toISOString()
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `✅ <b>TRANSAKSI TERKIRIM</b> ✅\n\nID: <code>${preorder.id}</code>\nResponse:\n<pre>${JSON.stringify(trxRes, null, 2)}</pre>\n\nStatus diubah/tetap <b>retrying</b> untuk memantau history.`);

                } catch (error) {
                    logger.error(`Trx failed for ${preorder.id}`, error.message);
                    
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'error',
                          keterangan: error.message,
                          updated_at: new Date().toISOString()
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `❌ <b>TRANSAKSI GAGAL/ERROR KONEKSI</b> ❌\n\nID: <code>${preorder.id}</code>\nError: ${error.message}\n\nMasuk ke status <b>error</b>. Harap cek manual atau gunakan /edit untuk mengulang.`);
                }
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
