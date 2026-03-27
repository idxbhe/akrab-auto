const api = require('./api');
const { db, historyDb } = require('./db');
const logger = require('./logger');

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Checker started with interval: ${intervalMs}ms`);
    
    async function run() {
        try {
            logger.info('--- MEMULAI SIKLUS PENGECEKAN STOK ---');
            await checkAndProcess(bot);
        } catch (err) {
            logger.error('Checker CRITICAL error in run():', err.message);
        } finally {
            logger.info(`Siklus selesai. Cek selanjutnya dalam ${intervalMs / 1000} detik...`);
            setTimeout(run, intervalMs);
        }
    }
    
    run();
}

async function checkAndProcess(bot) {
    const preorders = db.get('preorders').value() || [];
    
    // 1. Cek status order yang EXECUTED menggunakan /history
    const executedOrders = preorders.filter(p => p.status === 'EXECUTED');
    if (executedOrders.length > 0) {
        logger.info(`Mengecek status untuk ${executedOrders.length} order EXECUTED...`);
        for (const order of executedOrders) {
            // ... (logika pengecekan yang sudah ada)
        }
    } else {
        logger.info('Tidak ada order EXECUTED untuk dicek statusnya.');
    }

    // 2. Eksekusi transaksi untuk yang UNPROCESSED
    const currentPreorders = db.get('preorders').value() || [];
    const ordersToTrx = currentPreorders.filter(p => p.status === 'UNPROCESSED' || p.status === 'pending');

    if (ordersToTrx.length === 0) {
        logger.info('Tidak ada order UNPROCESSED/pending untuk dieksekusi.');
        return;
    }

    logger.info(`Ditemukan ${ordersToTrx.length} order UNPROCESSED. Mengambil stok...`);
    let stockRes;
    try {
        stockRes = await api.cekStock();
    } catch (err) {
        logger.error('Gagal mengambil stok:', err.message);
        return;
    }

    let stocks = [];
    if (Array.isArray(stockRes)) {
        stocks = stockRes;
    } else if (stockRes && Array.isArray(stockRes.data)) {
        stocks = stockRes.data;
    } else {
        logger.warn('Format stok tidak dikenali:', stockRes);
        return;
    }

    logger.info(`Stok dari server: ${stocks.length} produk ditemukan.`);

    for (const preorder of ordersToTrx) {
        const productStock = stocks.find(s => 
            (s.type && s.type.toUpperCase() === preorder.kode_produk.toUpperCase()) || 
            (s.kode_produk && s.kode_produk.toUpperCase() === preorder.kode_produk.toUpperCase()) ||
            (s.kode && s.kode.toUpperCase() === preorder.kode_produk.toUpperCase())
        );

        if (!productStock) {
            logger.warn(`Produk ${preorder.kode_produk} tidak ditemukan di data stok server.`);
            continue;
        }

        const sisaSlotStr = productStock.sisa_slot || productStock.stok || productStock.stock || productStock.sisa || 0;
        const sisaSlot = parseInt(sisaSlotStr, 10);
        
        if (sisaSlot > 0) {
            logger.info(`EKSEKUSI OTOMATIS: ${preorder.nomor} (${preorder.kode_produk}) - Slot: ${sisaSlot}`);
            
            broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI OTOMATIS</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot: ${sisaSlot}`);

            try {
                const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                logger.info(`Hasil Trx ${preorder.id}:`, trxRes);
                
                db.get('preorders')
                  .find({ id: preorder.id })
                  .assign({
                      status: 'EXECUTED',
                      keterangan: 'Auto: ' + (trxRes.msg || trxRes.message || JSON.stringify(trxRes)),
                      updated_at: new Date().toISOString()
                  })
                  .write();
                  
                broadcastToAdmins(bot, `🚀 <b>TRANSAKSI TEREKSEKUSI</b> 🚀\n\nID: <code>${preorder.id}</code>\nNomor: ${preorder.nomor}\nStatus: <b>EXECUTED</b>\n\nMenunggu update selanjutnya...`);

            } catch (error) {
                logger.error(`Trx Gagal untuk ${preorder.id}:`, error.message);
                broadcastToAdmins(bot, `❌ <b>KONEKSI GAGAL SAAT TRANSAKSI</b> ❌\n\nID: <code>${preorder.id}</code>\nError: ${error.message}\n\nStatus tetap <b>UNPROCESSED</b>.`);
            }
        } else {
            logger.info(`Stok untuk ${preorder.kode_produk} kosong (0). Skip.`);
        }
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

module.exports = {
    startChecker,
    broadcastToAdmins
};
