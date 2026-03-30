const api = require('./api');
const { db, historyDb } = require('./db');
const logger = require('./logger');

function isPeakHour() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 8 && hour < 12;
}

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Checker started with base interval: ${intervalMs}ms`);
    
    async function run() {
        try {
            const isPeak = isPeakHour();
            const currentInterval = isPeak ? Math.floor(intervalMs / 2) : intervalMs;
            
            logger.debug(`--- MEMULAI SIKLUS PENGECEKAN STOK (${isPeak ? 'PEAK HOUR' : 'NORMAL'}) ---`);
            await checkAndProcess(bot);
            
            logger.debug(`Siklus selesai. Cek selanjutnya dalam ${currentInterval / 1000} detik...`);
            setTimeout(run, currentInterval);
        } catch (err) {
            logger.error('Checker CRITICAL error in run():', err.message);
            setTimeout(run, intervalMs); // Fallback to base interval on error
        }
    }
    
    run();
}

async function checkAndProcess(bot) {
    const preorders = db.get('preorders').value() || [];
    const now = Date.now();
    const isPeak = isPeakHour();
    
    // 1. Cek status order yang EXECUTED atau PENDING menggunakan /history
    const trackableOrders = preorders.filter(p => p.status === 'EXECUTED' || p.status === 'PENDING');
    if (trackableOrders.length > 0) {
        logger.info(`Mengecek status untuk ${trackableOrders.length} order (EXECUTED/PENDING)...`);
        for (const order of trackableOrders) {
            // Check if it's time to check this order
            if (order.next_status_check && now < order.next_status_check) {
                const waitSec = Math.round((order.next_status_check - now) / 1000);
                logger.debug(`Order ${order.id} menunggu ${waitSec} detik lagi untuk pengecekan status.`);
                continue;
            }

            try {
                const historyRes = await api.cekHistory(order.reff_id);
                if (historyRes && historyRes.ok && Array.isArray(historyRes.data) && historyRes.data.length > 0) {
                    const hData = historyRes.data[0];
                    const statusText = (hData.status_text || '').toUpperCase();
                    let finalStatus = null;

                    if (statusText === 'SUKSES' || statusText === 'SUCCESS') {
                        finalStatus = 'SUKSES';
                    } else if (statusText === 'GAGAL' || statusText === 'ERROR' || statusText === 'BATAL') {
                        finalStatus = 'GAGAL';
                    } else if (statusText === 'PENDING') {
                        finalStatus = 'PENDING';
                    }

                    if (finalStatus && finalStatus !== order.status) {
                        db.get('preorders')
                            .find({ id: order.id })
                            .assign({
                                status: finalStatus,
                                keterangan: hData.keterangan || statusText,
                                updated_at: new Date().toISOString()
                            })
                            .write();
                        
                        logger.info(`Order ${order.id} updated to ${finalStatus} via auto-history check. Ket: ${hData.keterangan}`);

                        if (finalStatus === 'SUKSES') {
                            const completedOrder = db.get('preorders').find({ id: order.id }).value();
                            historyDb.get('history').push(completedOrder).write();
                            db.get('preorders').remove({ id: order.id }).write();
                        }
                    } else if (finalStatus === 'PENDING') {
                         logger.info(`Order ${order.id} masih PENDING di server. Pengecekan ulang dalam 10 detik.`);
                         db.get('preorders')
                          .find({ id: order.id })
                          .assign({
                              next_status_check: now + 10000,
                              empty_check_count: 0
                          })
                          .write();
                    } else {
                        // EXECUTED but not yet PENDING/SUKSES/GAGAL in data? (Wait)
                        logger.info(`Order ${order.id} status ${statusText} di server. Pengecekan ulang dalam 10 detik.`);
                        db.get('preorders')
                          .find({ id: order.id })
                          .assign({
                              next_status_check: now + 10000,
                              empty_check_count: 0
                          })
                          .write();
                    }
                } else {
                    // Data is empty
                    const newEmptyCount = (order.empty_check_count || 0) + 1;
                    logger.warn(`Order ${order.id} tidak ditemukan di history server (${newEmptyCount}/6).`);

                    if (newEmptyCount >= 6) {
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
                    } else {
                        db.get('preorders')
                          .find({ id: order.id })
                          .assign({
                              next_status_check: now + 10000,
                              empty_check_count: newEmptyCount
                          })
                          .write();
                        logger.info(`Order ${order.id} dijadwalkan ulang dalam 10 detik.`);
                    }
                }
            } catch (err) {
                logger.error(`Failed to check history for order ${order.id}: ${err.message}`);
                db.get('preorders')
                  .find({ id: order.id })
                  .assign({ next_status_check: now + 10000 })
                  .write();
            }
        }
    }

    // 2. Eksekusi transaksi untuk yang UNPROCESSED
    const currentPreorders = db.get('preorders').value() || [];
    const unprocessedOrders = currentPreorders.filter(p => p.status === 'UNPROCESSED' || p.status === 'pending');

    if (unprocessedOrders.length === 0) {
        return;
    }

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
        return;
    }

    for (const preorder of unprocessedOrders) {
        const productStock = stocks.find(s => 
            (s.type && s.type.toUpperCase() === preorder.kode_produk.toUpperCase()) || 
            (s.kode_produk && s.kode_produk.toUpperCase() === preorder.kode_produk.toUpperCase()) ||
            (s.kode && s.kode.toUpperCase() === preorder.kode_produk.toUpperCase())
        );

        if (!productStock) continue;

        const sisaSlotStr = productStock.sisa_slot || productStock.stok || productStock.stock || productStock.sisa || 0;
        const sisaSlot = parseInt(sisaSlotStr, 10);
        
        const ghostLevels = db.get('ghost_levels').value() || {};
        const kodeProduk = preorder.kode_produk;
        if (sisaSlot === 0 && ghostLevels[kodeProduk]) {
            ghostLevels[kodeProduk] = 0;
            db.set('ghost_levels', ghostLevels).write();
        }

        const currentGhostLevel = ghostLevels[kodeProduk] || 0;
        if (sisaSlot > 0) {
            if (sisaSlot === currentGhostLevel) {
                continue;
            }

            logger.info(`EKSEKUSI OTOMATIS: ${preorder.nomor} (${preorder.kode_produk}) - Slot: ${sisaSlot}`);
            
            try {
                const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                logger.info(`Hasil Trx ${preorder.id}:`, trxRes);
                
                if (trxRes.ok) {
                    const firstDelay = isPeak ? 5000 : 10000;
                    db.get('preorders')
                      .find({ id: preorder.id })
                      .assign({
                          status: 'EXECUTED',
                          attempted_stock: sisaSlot,
                          keterangan: 'Auto: ' + (trxRes.msg || 'Akan diproses'),
                          updated_at: new Date().toISOString(),
                          next_status_check: Date.now() + firstDelay,
                          empty_check_count: 0
                      })
                      .write();
                } else {
                    const msg = (trxRes.msg || trxRes.error || '').toLowerCase();
                    
                    if (msg.includes('rate_limited')) {
                        logger.warn(`Rate limit reached (4 trx/sec). Skipping execution for ${preorder.id}.`);
                        continue;
                    }
                    
                    if (msg.includes('pending masih 2')) {
                        logger.warn(`Max pending (2) reached. Stopping execution cycle.`);
                        break; 
                    }

                    if (msg.includes('stok kosong')) {
                        logger.error(`Ghost Stock confirmed via Trx rejection for ${preorder.id} at level ${sisaSlot}.`);
                        const updatedGhostLevels = db.get('ghost_levels').value() || {};
                        updatedGhostLevels[kodeProduk] = sisaSlot;
                        db.set('ghost_levels', updatedGhostLevels).write();
                        
                        db.get('preorders')
                          .find({ id: preorder.id })
                          .assign({
                              keterangan: `Ghost Stock terdeteksi: ${sisaSlot}.`,
                              updated_at: new Date().toISOString()
                          })
                          .write();
                        continue;
                    }

                    if (msg.includes('saldo tidak mencukupi')) {
                        logger.error(`Insufficient balance for order ${preorder.id}. Setting to GAGAL.`);
                        db.get('preorders')
                          .find({ id: preorder.id })
                          .assign({
                              status: 'GAGAL',
                              keterangan: trxRes.msg,
                              updated_at: new Date().toISOString()
                          })
                          .write();
                        continue;
                    }

                    // For other errors, log and keep as UNPROCESSED for retry
                    logger.error(`Trx rejected for ${preorder.id}: ${trxRes.msg}`);
                }
            } catch (error) {
                logger.error(`Trx Gagal untuk ${preorder.id}:`, error.message);
            }
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
    broadcastToAdmins,
    isPeakHour
};

