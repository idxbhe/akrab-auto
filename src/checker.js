const api = require('./api');
const { db, historyDb } = require('./db');
const { generateReffId } = require('./utils');
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
                    const keterangan = (hData.keterangan || '').toUpperCase();

                    // Penanganan khusus HTTP_CLIENT_RESPONSE_BODY_ERR
                    if (keterangan.includes('HTTP_CLIENT_RESPONSE_BODY_ERR')) {
                        const errCount = (order.http_err_count || 0) + 1;
                        if (errCount === 1) {
                            logger.warn(`Order ${order.id} mendapat HTTP_CLIENT_RESPONSE_BODY_ERR. Menunggu 5 detik untuk cek ulang.`);
                            db.get('preorders').find({ id: order.id }).assign({
                                http_err_count: 1,
                                next_status_check: now + 5000
                            }).write();
                            continue; 
                        } else {
                            // Pengecekan kedua masih error, reset ke UNPROCESSED
                            logger.error(`Order ${order.id} masih HTTP_CLIENT_RESPONSE_BODY_ERR. Auto-retry (Reset ke UNPROCESSED).`);
                            const newReffId = generateReffId(order.nomor, order.kode_produk, order.nama_produk);
                            db.get('preorders').find({ id: order.id }).assign({
                                status: 'UNPROCESSED',
                                reff_id: newReffId,
                                keterangan: 'Auto-retry: HTTP_CLIENT_ERR',
                                updated_at: new Date().toISOString(),
                                next_status_check: 0,
                                empty_check_count: 0,
                                http_err_count: 0
                            }).write();
                            continue;
                        }
                    } else if (keterangan.includes('STOCK TRANSAKSI HABIS')) {
                        // Penanganan GAGAL - Stock Transaksi Habis (Auto-retry sesuai feedback user)
                        logger.warn(`Order ${order.id} GAGAL (Stock Habis). Auto-retry (Reset ke UNPROCESSED).`);
                        const newReffId = generateReffId(order.nomor, order.kode_produk, order.nama_produk);
                        
                        db.get('preorders').find({ id: order.id }).assign({
                            status: 'UNPROCESSED',
                            reff_id: newReffId,
                            keterangan: 'Auto-retry: ' + hData.keterangan,
                            updated_at: new Date().toISOString(),
                            next_status_check: 0,
                            empty_check_count: 0,
                            http_err_count: 0
                        }).write();
                        continue;
                    } else if (order.http_err_count) {
                        // Reset jika error sudah hilang
                        db.get('preorders').find({ id: order.id }).assign({ http_err_count: 0 }).write();
                    }

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
    const systemConfig = db.get('system_config').value() || { is_paused: false };
    if (systemConfig.is_paused) {
        logger.debug('Bot sedang DIPAUSE (Saldo Habis). Melewati eksekusi UNPROCESSED.');
        return;
    }

    const currentPreorders = db.get('preorders').value() || [];
    
    // Proactive Pending Guard: Cek antrean aktif di lokal
    const activeOrders = currentPreorders.filter(p => p.status === 'EXECUTED' || p.status === 'PENDING');
    if (activeOrders.length >= 2) {
        logger.debug(`Batas pending tercapai (${activeOrders.length}). Menunda eksekusi UNPROCESSED.`);
        return;
    }

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
        const currentGhostLevel = ghostLevels[kodeProduk] || 0;

        // Reset ghost level if current stock is different from the ghost level (higher/lower/zero)
        if (currentGhostLevel > 0 && sisaSlot !== currentGhostLevel) {
            delete ghostLevels[kodeProduk];
            db.set('ghost_levels', ghostLevels).write();
        }

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
                    
                    // Clear ghost level on successful transaction
                    const updatedGhostLevels = db.get('ghost_levels').value() || {};
                    if (updatedGhostLevels[kodeProduk]) {
                        delete updatedGhostLevels[kodeProduk];
                        db.set('ghost_levels', updatedGhostLevels).write();
                    }
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
                        logger.error(`Insufficient balance detected for ${preorder.id}. PAUSING BOT.`);
                        
                        // Set system pause in DB
                        db.set('system_config', {
                            is_paused: true,
                            pause_reason: 'Saldo tidak mencukupi',
                            last_pause_at: new Date().toISOString()
                        }).write();

                        // Notify all admins
                        const { Markup } = require('telegraf');
                        const adminMsg = `⚠️ <b>BOT DIPAUSE OTOMATIS</b>\n\n` +
                                         `Saldo di panel tidak mencukupi untuk transaksi:\n` +
                                         `<code>Nomor : ${preorder.nomor}</code>\n` +
                                         `<code>Paket : ${preorder.nama_produk}</code>\n\n` +
                                         `Silakan isi saldo dan klik tombol di bawah untuk melanjutkan.`;
                        
                        const adminChatIds = db.get('admin_chats').value() || [];
                        for (const chatId of adminChatIds) {
                            bot.telegram.sendMessage(chatId, adminMsg, { 
                                parse_mode: 'HTML',
                                ...Markup.inlineKeyboard([
                                    Markup.button.callback('✅ Saldo Sudah Diisi', 'resume_bot')
                                ])
                            }).catch(e => logger.error(`Failed to notify admin ${chatId}`, e.message));
                        }
                        
                        break; // Stop checking other UNPROCESSED in this cycle
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

