const api = require('./api');
const { db, historyDb } = require('./db');
const logger = require('./logger');

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Checker started with interval: ${intervalMs}ms`);
    
    async function run() {
        try {
            logger.debug('--- MEMULAI SIKLUS PENGECEKAN STOK ---');
            await checkAndProcess(bot);
        } catch (err) {
            logger.error('Checker CRITICAL error in run():', err.message);
        } finally {
            logger.debug(`Siklus selesai. Cek selanjutnya dalam ${intervalMs / 1000} detik...`);
            setTimeout(run, intervalMs);
        }
    }
    
    run();
}

async function checkAndProcess(bot) {
    const preorders = db.get('preorders').value() || [];
    const now = Date.now();
    
    // 1. Cek status order yang EXECUTED menggunakan /history
    const executedOrders = preorders.filter(p => p.status === 'EXECUTED');
    if (executedOrders.length > 0) {
        logger.info(`Mengecek status untuk ${executedOrders.length} order EXECUTED...`);
        for (const order of executedOrders) {
            // Check if it's time to check this order
            if (order.next_status_check && now < order.next_status_check) {
                const waitSec = Math.round((order.next_status_check - now) / 1000);
                logger.info(`Order ${order.id} menunggu ${waitSec} detik lagi untuk pengecekan status.`);
                continue;
            }

            try {
                const historyRes = await api.cekHistory(order.reff_id);
                if (historyRes && historyRes.ok && Array.isArray(historyRes.data) && historyRes.data.length > 0) {
                    const hData = historyRes.data[0];
                    const statusText = (hData.status_text || '').toUpperCase();
                    let finalStatus = null;

                    if (statusText === 'SUKSES' || statusText === 'SUCCESS') {
                        finalStatus = 'SUCCESS';
                    } else if (statusText === 'GAGAL' || statusText === 'ERROR' || statusText === 'BATAL') {
                        finalStatus = 'ERROR';
                    }

                    if (finalStatus) {
                        db.get('preorders')
                            .find({ id: order.id })
                            .assign({
                                status: finalStatus,
                                keterangan: hData.keterangan || statusText,
                                updated_at: new Date().toISOString()
                            })
                            .write();
                        
                        logger.info(`Order ${order.id} updated to ${finalStatus} via auto-history check. Ket: ${hData.keterangan}`);
                        const notifyMsg = `🔔 <b>STATUS UPDATE (AUTO CHECK)</b>\n\n` +
                                          `<code>ID      : ${order.id}</code>\n` +
                                          `<code>Nomor   : ${order.nomor}</code>\n` +
                                          `<code>Paket   : ${order.nama_produk}</code>\n` +
                                          `<code>Status  : ${finalStatus}</code>\n` +
                                          `<code>Ket     : ${hData.keterangan || statusText}</code>\n` +
                                          `---------------------------------------------------------\n` +
                                          `Waktu   : ${logger.formatDate(new Date().toISOString())}`;
                        broadcastToAdmins(bot, notifyMsg);

                        if (finalStatus === 'SUCCESS') {
                            const completedOrder = db.get('preorders').find({ id: order.id }).value();
                            historyDb.get('history').push(completedOrder).write();
                            db.get('preorders').remove({ id: order.id }).write();
                        }
                    } else {
                        logger.info(`Order ${order.id} masih ${statusText} di server. Pengecekan ulang dalam 1 menit.`);
                        db.get('preorders')
                          .find({ id: order.id })
                          .assign({
                              next_status_check: now + 60000,
                              empty_check_count: 0 // Reset empty count because data was found
                          })
                          .write();
                    }
                } else {
                    // Data is empty
                    const newEmptyCount = (order.empty_check_count || 0) + 1;
                    logger.warn(`Order ${order.id} tidak ditemukan di history server (${newEmptyCount}/3).`);

                    if (newEmptyCount >= 3) {
                        const attemptedStock = order.attempted_stock || 0;
                        const kodeProduk = order.kode_produk;
                        
                        // Update ghost_levels in DB
                        const ghostLevels = db.get('ghost_levels').value() || {};
                        ghostLevels[kodeProduk] = attemptedStock;
                        db.set('ghost_levels', ghostLevels).write();

                        db.get('preorders')
                            .find({ id: order.id })
                            .assign({
                                status: 'UNPROCESSED',
                                keterangan: `Ghost Stock terdeteksi pada level ${attemptedStock}. Menunggu stok bertambah.`,
                                updated_at: new Date().toISOString(),
                                next_status_check: 0,
                                empty_check_count: 0
                            })
                            .write();
                        
                        logger.error(`Ghost Stock detected for order ${order.id} at level ${attemptedStock}. Reverting to UNPROCESSED.`);
                        const notifyMsg = `⚠️ <b>GHOST STOCK TERDETEKSI</b>\n\n` +
                                          `<code>ID      : ${order.id}</code>\n` +
                                          `<code>Nomor   : ${order.nomor}</code>\n` +
                                          `<code>Paket   : ${order.nama_produk}</code>\n` +
                                          `<code>Level   : ${attemptedStock}</code>\n` +
                                          `---------------------------------------------------------\n` +
                                          `Waktu   : ${logger.formatDate(new Date().toISOString())}\n\n` +
                                          `<i>Sistem akan mengabaikan stok ini sampai jumlah stok bertambah.</i>`;
                        broadcastToAdmins(bot, notifyMsg);
                    } else {
                        db.get('preorders')
                          .find({ id: order.id })
                          .assign({
                              next_status_check: now + 60000,
                              empty_check_count: newEmptyCount
                          })
                          .write();
                        logger.info(`Order ${order.id} dijadwalkan ulang dalam 1 menit.`);
                    }
                }
            } catch (err) {
                logger.error(`Failed to check history for order ${order.id}: ${err.message}`);
                // Retry in 1 minute on network error
                db.get('preorders')
                  .find({ id: order.id })
                  .assign({ next_status_check: now + 60000 })
                  .write();
            }
        }
    } else {
        logger.debug('Tidak ada order EXECUTED untuk dicek statusnya.');
    }

    // 2. Eksekusi transaksi untuk yang UNPROCESSED
    const currentPreorders = db.get('preorders').value() || [];
    const unprocessedOrders = currentPreorders.filter(p => p.status === 'UNPROCESSED' || p.status === 'pending');

    if (unprocessedOrders.length === 0) {
        logger.debug('Tidak ada order UNPROCESSED/pending. Melewati pengecekan stok.');
        return;
    }

    logger.debug(`Ditemukan ${unprocessedOrders.length} order UNPROCESSED. Mengambil stok...`);
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

    logger.debug(`Stok dari server: ${stocks.length} produk ditemukan.`);

    for (const preorder of unprocessedOrders) {
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
        
        // Reset ghost_level if stock drops to 0
        const ghostLevels = db.get('ghost_levels').value() || {};
        const kodeProduk = preorder.kode_produk;
        if (sisaSlot === 0 && ghostLevels[kodeProduk]) {
            ghostLevels[kodeProduk] = 0;
            db.set('ghost_levels', ghostLevels).write();
            logger.debug(`Ghost level for ${kodeProduk} reset to 0 because stock reached 0.`);
        }

        const currentGhostLevel = ghostLevels[kodeProduk] || 0;
        if (sisaSlot > 0) {
            // Check against ghost level - only skip if EXACTLY the same
            if (sisaSlot === currentGhostLevel) {
                logger.debug(`Skipping ${preorder.nomor} (${kodeProduk}) because stock level ${sisaSlot} is still at confirmed ghost level.`);
                continue;
            }

            logger.info(`EKSEKUSI OTOMATIS: ${preorder.nomor} (${preorder.kode_produk}) - Slot: ${sisaSlot}`);
            
            const startNotifyMsg = `🔔 <b>MEMULAI TRANSAKSI OTOMATIS</b>\n\n` +
                                   `<code>ID      : ${preorder.id}</code>\n` +
                                   `<code>Nomor   : ${preorder.nomor}</code>\n` +
                                   `<code>Paket   : ${preorder.nama_produk}</code>\n` +
                                   `<code>Reff ID : ${preorder.reff_id}</code>\n` +
                                   `<code>Level   : ${sisaSlot}</code>\n` +
                                   `---------------------------------------------------------\n` +
                                   `Waktu   : ${logger.formatDate(new Date().toISOString())}`;
            broadcastToAdmins(bot, startNotifyMsg);

            try {
                const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                logger.info(`Hasil Trx ${preorder.id}:`, trxRes);
                
                db.get('preorders')
                  .find({ id: preorder.id })
                  .assign({
                      status: 'EXECUTED',
                      attempted_stock: sisaSlot,
                      keterangan: 'Auto: ' + (trxRes.msg || trxRes.message || JSON.stringify(trxRes)),
                      updated_at: new Date().toISOString(),
                      next_status_check: Date.now() + 10000,
                      empty_check_count: 0
                  })
                  .write();
                  
                const execNotifyMsg = `🚀 <b>TRANSAKSI TEREKSEKUSI</b>\n\n` +
                                      `<code>ID      : ${preorder.id}</code>\n` +
                                      `<code>Nomor   : ${preorder.nomor}</code>\n` +
                                      `<code>Status  : EXECUTED</code>\n` +
                                      `---------------------------------------------------------\n` +
                                      `Waktu   : ${logger.formatDate(new Date().toISOString())}\n\n` +
                                      `<i>Menunggu pengecekan otomatis dalam 10 detik...</i>`;
                broadcastToAdmins(bot, execNotifyMsg);

            } catch (error) {
                logger.error(`Trx Gagal untuk ${preorder.id}:`, error.message);
                const failNotifyMsg = `❌ <b>KONEKSI GAGAL SAAT TRANSAKSI</b>\n\n` +
                                      `<code>ID      : ${preorder.id}</code>\n` +
                                      `<code>Nomor   : ${preorder.nomor}</code>\n` +
                                      `<code>Error   : ${error.message}</code>\n` +
                                      `---------------------------------------------------------\n` +
                                      `Waktu   : ${logger.formatDate(new Date().toISOString())}\n\n` +
                                      `<i>Status tetap UNPROCESSED.</i>`;
                broadcastToAdmins(bot, failNotifyMsg);
            }
        } else {
            logger.debug(`Stok untuk ${preorder.kode_produk} kosong (0). Skip.`);
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
