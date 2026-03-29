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
                        broadcastToAdmins(bot, `🔔 <b>STATUS UPDATE (AUTO CHECK)</b> 🔔\n\nID: <code>${order.id}</code>\nNomor: ${order.nomor}\nPaket: ${order.nama_produk}\nStatus: <b>${finalStatus}</b>\nKet: ${hData.keterangan || statusText}`);

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
                        const finalStatus = 'ERROR';
                        const keterangan = 'Status tidak pasti (data tidak ditemukan di server setelah 3 kali cek)';
                        
                        db.get('preorders')
                            .find({ id: order.id })
                            .assign({
                                status: finalStatus,
                                keterangan: keterangan,
                                updated_at: new Date().toISOString()
                            })
                            .write();
                        
                        logger.error(`Order ${order.id} dihentikan pengecekannya. Status: ${finalStatus}`);
                        broadcastToAdmins(bot, `⚠️ <b>TRANSAKSI BERAKHIR (TIMEOUT)</b> ⚠️\n\nID: <code>${order.id}</code>\nNomor: ${order.nomor}\nPaket: ${order.nama_produk}\nStatus: <b>ERROR</b>\nKet: ${keterangan}`);
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

    logger.info(`Ditemukan ${unprocessedOrders.length} order UNPROCESSED. Mengambil stok...`);
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
                      updated_at: new Date().toISOString(),
                      next_status_check: Date.now() + 10000,
                      empty_check_count: 0
                  })
                  .write();
                  
                broadcastToAdmins(bot, `🚀 <b>TRANSAKSI TEREKSEKUSI</b> 🚀\n\nID: <code>${preorder.id}</code>\nNomor: ${preorder.nomor}\nStatus: <b>EXECUTED</b>\n\nMenunggu pengecekan otomatis dalam 10 detik...`);

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
