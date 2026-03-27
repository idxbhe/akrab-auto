const api = require('./api');
const { db, historyDb } = require('./db');
const logger = require('./logger');

async function checkAndProcess(bot) {
    try {
        const preorders = db.get('preorders').value() || [];
        
        // 1. Cek status order yang EXECUTED menggunakan /history
        const executedOrders = preorders.filter(p => p.status === 'EXECUTED');
        for (const order of executedOrders) {
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
                        
                        logger.info(`Order ${order.id} status updated via checker to ${finalStatus}`);
                        
                        const notifyMsg = `🔔 <b>STATUS UPDATE (CHECKER)</b> 🔔\n\nID: <code>${order.id}</code>\nNomor: ${order.nomor}\nPaket: ${order.nama_produk}\nStatus: <b>${finalStatus}</b>\nKet: ${hData.keterangan || statusText}`;
                        broadcastToAdmins(bot, notifyMsg);

                        if (finalStatus === 'SUCCESS') {
                            const completedOrder = db.get('preorders').find({ id: order.id }).value();
                            historyDb.get('history').push(completedOrder).write();
                            db.get('preorders').remove({ id: order.id }).write();
                            logger.info(`Order ${order.id} moved to history by checker`);
                        }
                    }
                }
            } catch (err) {
                logger.error(`Failed to check history for EXECUTED order ${order.id}`, err.message);
            }
        }

        // 2. Eksekusi transaksi untuk yang UNPROCESSED
        // Get updated preorders after potential history moves
        const currentPreorders = db.get('preorders').value() || [];
        const ordersToTrx = currentPreorders.filter(p => p.status === 'UNPROCESSED' || p.status === 'pending');

        if (ordersToTrx.length === 0) return;

        const stockRes = await api.cekStock();
        let stocks = [];
        if (Array.isArray(stockRes)) {
            stocks = stockRes;
        } else if (stockRes && Array.isArray(stockRes.data)) {
            stocks = stockRes.data;
        } else {
            logger.warn('Failed to parse stock from server, invalid format', stockRes);
            return;
        }

        logger.info(`Stok terdeteksi: ${stocks.length} item.`);
        // Optional: log specific stock details if needed
        // logger.debug('Detail stok:', stocks);

        for (const preorder of ordersToTrx) {
            const productStock = stocks.find(s => s.type === preorder.kode_produk || s.kode_produk === preorder.kode_produk);
            const sisaSlotStr = productStock ? (productStock.sisa_slot || productStock.stok || productStock.stock || 0) : 0;
            const sisaSlot = parseInt(sisaSlotStr, 10);
            
            if (productStock && sisaSlot > 0) {
                logger.info(`Stock found for ${preorder.kode_produk} (Slot: ${sisaSlot}). Executing trx...`, { id: preorder.id });
                
                broadcastToAdmins(bot, `🔔 <b>MEMULAI TRANSAKSI OTOMATIS</b> 🔔\n\nID: <code>${preorder.id}</code>\nNomor: <code>${preorder.nomor}</code>\nProduk: ${preorder.nama_produk} (${preorder.kode_produk})\nReff ID: <code>${preorder.reff_id}</code>\nSisa Slot: ${sisaSlot}`);

                try {
                    const trxRes = await api.doTransaksi(preorder.kode_produk, preorder.nomor, preorder.reff_id);
                    logger.info(`Trx result for ${preorder.id}`, trxRes);
                    
                    const isFailedTrx = !trxRes || trxRes.ok === false || trxRes.status === false || (trxRes.message && trxRes.message.toLowerCase().includes('gagal'));

                    if (isFailedTrx) {
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
                          
                        broadcastToAdmins(bot, `🚀 <b>TRANSAKSI TEREKSEKUSI</b> 🚀\n\nID: <code>${preorder.id}</code>\nNomor: ${preorder.nomor}\nPaket: ${preorder.nama_produk}\nStatus: <b>EXECUTED</b>\n\nMenunggu update dari webhook / auto check...`);
                    }

                } catch (error) {
                    logger.error(`Trx failed for ${preorder.id}`, error.message);
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
    
    for (const chatId of adminChatIds) {
        bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' }).catch(e => {
            logger.error(`Failed to send message to ${chatId}`, e.message);
        });
    }
}

function startChecker(bot, intervalMs = 10000) {
    logger.info(`Starting checker with interval ${intervalMs}ms`);
    
    async function run() {
        logger.info('Mengecek stok dan status order secara otomatis...');
        await checkAndProcess(bot);
        logger.info(`Cek selanjutnya dalam ${intervalMs / 1000} detik...`);
        setTimeout(run, intervalMs);
    }
    
    run();
}

module.exports = {
    startChecker,
    broadcastToAdmins
};
