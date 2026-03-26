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
                    db.get('preorders')
                      .find({ id: p.id })
                      .assign({ 
                          status: 'success', 
                          updated_at: new Date().toISOString() 
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `🎉 <b>TRANSAKSI SUKSES</b> 🎉\n\nID: <code>${p.id}</code>\nNomor: ${p.nomor}\nPaket: ${p.nama_produk}`);
                } else if (historyStr.includes('gagal') || historyStr.includes('failed') || historyStr.includes('batal')) {
                    // Transaksi gagal dari sisi server, set flag needsTrx di DB
                    db.get('preorders')
                      .find({ id: p.id })
                      .assign({ 
                          needsTrx: true,
                          updated_at: new Date().toISOString()
                      })
                      .write();
                      
                    broadcastToAdmins(bot, `⚠️ <b>TRANSAKSI GAGAL/BATAL DARI SERVER</b> ⚠️\n\nID: <code>${p.id}</code>\nStatus tetap <b>retrying</b> (akan diulang saat stok tersedia)`);
                }
            } catch (err) {
                 logger.error(`History check failed for ${p.id}`, err.message);
            }
        }

        // Ambil data terbaru dari DB setelah update history
        const updatedPreorders = db.get('preorders').value();

        // 2. Process stock and trx for 'pending' AND ('retrying' yang butuh re-trx)
        const ordersToTrx = updatedPreorders.filter(p => 
            p.status === 'pending' || (p.status === 'retrying' && p.needsTrx)
        );

        if (ordersToTrx.length === 0) return;

        const stockRes = await api.cekStock();
        if (!stockRes || !stockRes.data) return;
        
        const stocks = stockRes.data;

        for (const preorder of ordersToTrx) {
            const productStock = stocks.find(s => s.type === preorder.kode_produk);
            const sisaSlot = productStock ? parseInt(productStock.sisa_slot, 10) : 0;
            
            if (productStock && sisaSlot > 0) {
                logger.info(`Stock found for ${preorder.kode_produk} (Slot: ${sisaSlot}). Executing trx...`, { id: preorder.id });
                
                broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot di server: ${sisaSlot}`);

                try {
                    const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                    logger.info(`Trx result for ${preorder.id}`, trxRes);
                    
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'retrying',
                          needsTrx: false, // reset flag setelah trx dikirim
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
            } else {
                // Tambahkan log jika stok tidak cukup atau produk tidak ditemukan
                if (!productStock) {
                    logger.warn(`Product ${preorder.kode_produk} not found in stock data`);
                } else if (sisaSlot <= 0) {
                    // logger.info(`Stock for ${preorder.kode_produk} is empty (${sisaSlot})`);
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
    
    async function run() {
        await checkAndProcess(bot);
        setTimeout(run, intervalMs);
    }
    
    run();
}

module.exports = {
    startChecker
};
