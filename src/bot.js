const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { startChecker, broadcastToAdmins, isPeakHour } = require('./checker');
const { db, historyDb } = require('./db');
const { generateReffId } = require('./utils');
const logger = require('./logger');
const api = require('./api');
const dotenv = require('dotenv');
dotenv.config();

const PRODUCTS = [
    { type: 'XLA14', nama: 'SuperMini', sisa_slot: 0 },
    { type: 'XLA32', nama: 'Mini', sisa_slot: 0 },
    { type: 'XLA39', nama: 'Big ', sisa_slot: 0 },
    { type: 'XLA51', nama: 'Jumbo V2', sisa_slot: 0 },
    { type: 'XLA65', nama: 'JUMBO', sisa_slot: 0 },
    { type: 'XLA89', nama: 'MegaBig', sisa_slot: 0 }
];

const mainMenu = Markup.keyboard([
    ['➕ Tambah', '📋 List'],
    ['📜 History', '📦 Cek Stok']
]).resize();

const addPreorderWizard = new Scenes.WizardScene(
    'add-preorder',
    (ctx) => {
        ctx.reply('<b>Masukkan nomor tujuan:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard([
            Markup.button.callback('❌ Batal', 'cancel')
        ])});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (!ctx.message || !ctx.message.text) {
             ctx.reply('⚠️ Harap masukkan teks nomor tujuan:');
             return;
        }
        
        if (ctx.message.text.toLowerCase() === 'batal') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            return ctx.scene.leave();
        }
        
        ctx.wizard.state.nomor = ctx.message.text;
        
        const buttons = PRODUCTS.map(p => Markup.button.callback(`${p.nama} (${p.type})`, `select_${p.type}`));
        const keyboardOptions = [];
        for (let i = 0; i < buttons.length; i += 2) {
            keyboardOptions.push(buttons.slice(i, i + 2));
        }
        keyboardOptions.push([Markup.button.callback('❌ Batal', 'cancel')]);
        
        ctx.reply('<b>Pilih paket Akrab:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboardOptions)});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.callbackQuery) return;
        
        const data = ctx.callbackQuery.data;
        if (data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (data.startsWith('select_')) {
            const kode = data.split('_')[1];
            const product = PRODUCTS.find(p => p.type === kode);
            if (!product) {
                ctx.reply('❌ Produk tidak ditemukan, ulangi proses.');
                return ctx.scene.leave();
            }
            
            const nomor = ctx.wizard.state.nomor;
            const reff_id = generateReffId(nomor, product.type, product.nama);
            
            const newPreorder = {
                id: Date.now().toString(),
                nomor: nomor,
                kode_produk: product.type,
                nama_produk: product.nama,
                status: 'UNPROCESSED',
                reff_id: reff_id,
                trx_id: '',
                keterangan: '',
                created_at: new Date().toISOString(),
                next_status_check: 0,
                empty_check_count: 0
            };
            
            db.get('preorders').push(newPreorder).write();
            
            const successMsg = `✅ <b>PRE-ORDER BERHASIL</b>\n\n` +
                               `<code>Nomor   : ${nomor}</code>\n` +
                               `<code>Paket   : ${product.nama} (${product.type})</code>\n` +
                               `<code>Status  : UNPROCESSED</code>\n` +
                               `---------------------------------------------------------\n` +
                               `Waktu   : ${logger.formatDate(new Date().toISOString())}`;
            
            ctx.reply(successMsg, { parse_mode: 'HTML', ...mainMenu });
            logger.info('Preorder added', newPreorder);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
    }
);

const deletePreorderWizard = new Scenes.WizardScene(
    'delete-preorder',
    (ctx) => {
        ctx.reply('🗑️ Masukkan ID pre-order yang ingin dihapus:\n\n(Atau klik tombol di bawah untuk membatalkan)', Markup.inlineKeyboard([
            Markup.button.callback('❌ Batal', 'cancel')
        ]));
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (!ctx.message || !ctx.message.text) return;
        const id = ctx.message.text;
        
        if (id.toLowerCase() === 'batal') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            return ctx.scene.leave();
        }

        const exists = db.get('preorders').find({ id }).value();
        if (!exists) {
            ctx.reply('❌ Pre-order tidak ditemukan. Kembali ke menu utama.', mainMenu);
            return ctx.scene.leave();
        }
        
        db.get('preorders').remove({ id }).write();
        ctx.reply(`✅ Pre-order berhasil dihapus.`, mainMenu);
        logger.info('Preorder deleted', { id });
        return ctx.scene.leave();
    }
);

const editPreorderWizard = new Scenes.WizardScene(
    'edit-preorder',
    (ctx) => {
        const id = ctx.scene.state.editId;
        if (id) {
            const exists = db.get('preorders').find({ id }).value();
            if (!exists) {
                ctx.reply('❌ Pre-order tidak ditemukan.', mainMenu);
                return ctx.scene.leave();
            }
            ctx.wizard.state.editId = id;
            ctx.reply(`✏️ Edit Pre-order\nNomor lama: ${exists.nomor}\n\n<b>Masukkan nomor tujuan baru:</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
                Markup.button.callback('❌ Batal', 'cancel')
            ])});
            ctx.wizard.selectStep(2);
            return;
        }

        ctx.reply('✏️ Masukkan ID pre-order yang ingin diedit:', Markup.inlineKeyboard([
            Markup.button.callback('❌ Batal', 'cancel')
        ]));
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (!ctx.message || !ctx.message.text) return;
        const id = ctx.message.text;

        if (id.toLowerCase() === 'batal') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            return ctx.scene.leave();
        }
        
        const exists = db.get('preorders').find({ id }).value();
        if (!exists) {
            ctx.reply('❌ Pre-order tidak ditemukan. Kembali ke menu utama.', mainMenu);
            return ctx.scene.leave();
        }
        
        ctx.wizard.state.editId = id;
        ctx.reply(`✅ Pre-order ditemukan.\nNomor lama: ${exists.nomor}\n\n<b>Masukkan nomor tujuan baru:</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
            Markup.button.callback('❌ Batal', 'cancel')
        ])});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text.toLowerCase() === 'batal') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            return ctx.scene.leave();
        }
        ctx.wizard.state.nomor = ctx.message.text;
        
        const buttons = PRODUCTS.map(p => Markup.button.callback(`${p.nama} (${p.type})`, `edit_select_${p.type}`));
        const keyboardOptions = [];
        for (let i = 0; i < buttons.length; i += 2) {
            keyboardOptions.push(buttons.slice(i, i + 2));
        }
        keyboardOptions.push([Markup.button.callback('❌ Batal', 'cancel')]);
        
        ctx.reply('<b>Pilih paket Akrab baru:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboardOptions)});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.callbackQuery) return;
        
        const data = ctx.callbackQuery.data;
        if (data === 'cancel') {
            ctx.reply('🚫 Dibatalkan.', mainMenu);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
        
        if (data.startsWith('edit_select_')) {
            const kode = data.split('_')[2];
            const product = PRODUCTS.find(p => p.type === kode);
            if (!product) {
                ctx.reply('❌ Produk tidak ditemukan, ulangi proses.', mainMenu);
                return ctx.scene.leave();
            }
            
            const id = ctx.wizard.state.editId;
            const nomor = ctx.wizard.state.nomor;
            const newReffId = generateReffId(nomor, product.type, product.nama);
            
            db.get('preorders')
              .find({ id })
              .assign({
                  nomor: nomor,
                  kode_produk: product.type,
                  nama_produk: product.nama,
                  reff_id: newReffId,
                  status: 'UNPROCESSED', // reset status
                  keterangan: 'Edited',
                  next_status_check: 0,
                  empty_check_count: 0
              })
              .write();
              
            const successMsg = `✅ <b>UPDATE PRE-ORDER BERHASIL</b>\n\n` +
                               `<code>Nomor   : ${nomor}</code>\n` +
                               `<code>Paket   : ${product.nama} (${product.type})</code>\n` +
                               `<code>Status  : UNPROCESSED</code>\n` +
                               `---------------------------------------------------------\n` +
                               `Waktu   : ${logger.formatDate(new Date().toISOString())}`;
              
            ctx.reply(successMsg, { parse_mode: 'HTML', ...mainMenu });
            logger.info('Preorder edited', { id, nomor, kode_produk: product.type });
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
    }
);

const stage = new Scenes.Stage([addPreorderWizard, deletePreorderWizard, editPreorderWizard]);

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

// Security middleware
bot.use((ctx, next) => {
    const username = ctx.from?.username?.toLowerCase();
    const allowedAdmins = (process.env.AUTHORIZED_USERS || 'kingbhe,umams1').toLowerCase().split(',').map(u => u.trim());
    
    if (ctx.message && ctx.message.text) {
        logger.info(`Text message from ${ctx.from?.username || 'unknown'}: ${ctx.message.text}`);
    } else if (ctx.callbackQuery) {
        logger.info(`Callback query from ${ctx.from?.username || 'unknown'}: ${ctx.callbackQuery.data}`);
    }

    if (allowedAdmins.includes(username)) {
        const chatId = ctx.chat?.id;
        if (chatId) {
            let adminChats = db.get('admin_chats').value() || [];
            if (!adminChats.includes(chatId)) {
                adminChats.push(chatId);
                db.set('admin_chats', adminChats).write();
            }
        }
        return next();
    }
    logger.warn('Unauthorized access attempt', { user: ctx.from });
    
    if (ctx.callbackQuery) {
        return ctx.answerCbQuery('❌ Anda tidak memiliki akses.', { show_alert: true });
    }
    return ctx.reply('❌ Anda tidak memiliki akses ke bot ini.');
});

bot.action('resume_bot', async (ctx) => {
    db.set('system_config', {
        is_paused: false,
        pause_reason: '',
        last_pause_at: null
    }).write();

    logger.info(`Bot resumed by ${ctx.from.username}`);
    
    try {
        await ctx.answerCbQuery('🚀 Bot dilanjutkan! Antrean akan segera diproses.');
        await ctx.editMessageText(`✅ <b>SISTEM DILANJUTKAN</b>\nBot akan kembali memproses antrean secara otomatis.`, { parse_mode: 'HTML' });
    } catch (e) {
        ctx.reply('✅ Saldo sudah diisi. Bot kembali berjalan!');
    }
});

bot.command('start', (ctx) => {
    ctx.reply('👋 Selamat datang di Bot Pre-Order Kuota Akrab.\n\nSilakan pilih menu di bawah ini:', mainMenu);
});

bot.hears('➕ Tambah', (ctx) => {
    ctx.scene.enter('add-preorder');
});

bot.hears('📋 List', async (ctx) => {
    const config = db.get('system_config').value() || { is_paused: false };
    if (config.is_paused) {
        await ctx.reply(`⚠️ <b>BOT SEDANG DIPAUSE</b>\nAlasan: ${config.pause_reason || 'Saldo Habis'}\n-----------------------------------`, { parse_mode: 'HTML' });
    }

    const preorders = db.get('preorders').value();
    if (!preorders || preorders.length === 0) {
        return ctx.reply('📭 Daftar pre-order kosong.', mainMenu);
    }
    
    ctx.reply('📋 <b>Daftar Pre-Order:</b>', { parse_mode: 'HTML', ...mainMenu });
    
    for (const p of preorders) {
        let msg = `<code>Nomor  :</code> <code>${p.nomor}</code>\n`;
        msg += `<code>Paket  :</code> <code>${p.nama_produk} (${p.kode_produk})</code>\n`;
        msg += `<code>Status :</code> <code>${p.status}</code>\n`;
        
        if (p.status === 'GAGAL') {
            msg += `<pre>⚠ ${p.keterangan || 'Gagal tanpa alasan'}</pre>\n`;
        }
        
        msg += `---------------------------------------------------------`;
        
        const row = [
            Markup.button.callback('🔍', `detail_${p.id}`),
            Markup.button.callback('🔄', `cekbtn_${p.id}`),
            Markup.button.callback('🚀', `execmanual_${p.id}`)
        ];
        
        if (p.status === 'GAGAL') {
            row.push(Markup.button.callback('♻️', `retrybtn_${p.id}`));
        }

        row.push(Markup.button.callback('✏️', `editbtn_${p.id}`));
        row.push(Markup.button.callback('🗑️', `deletebtn_${p.id}`));

        const buttons = Markup.inlineKeyboard([row]);
        await ctx.reply(msg, { parse_mode: 'HTML', ...buttons });
    }
});

bot.hears('📜 History', async (ctx) => {
    const history = historyDb.get('history').orderBy(['updated_at'], ['desc']).take(5).value();
    if (!history || history.length === 0) {
        return ctx.reply('📜 History kosong.', mainMenu);
    }

    let msg = '📜 **5 History Terakhir (SUCCESS):**\n\n';
    history.forEach((p, i) => {
        msg += `${i+1}. \`${p.nomor}\` - ${p.nama_produk}\n   📅 ${logger.formatDate(p.updated_at)}\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

bot.hears('📦 Cek Stok', async (ctx) => {
    const config = db.get('system_config').value() || { is_paused: false };
    if (config.is_paused) {
        await ctx.reply(`⚠️ <b>BOT SEDANG DIPAUSE</b>\nAlasan: ${config.pause_reason || 'Saldo Habis'}\n-----------------------------------`, { parse_mode: 'HTML' });
    }

    try {
        const stockRes = await api.cekStock();
        const stocks = stockRes.data;
        const ghostLevels = db.get('ghost_levels').value() || {};
        
        let msg = '📦 <b>Status Stok Akrab:</b>\n\n';
        if (stocks && Array.isArray(stocks) && stocks.length > 0) {
            PRODUCTS.forEach(p => {
                const stockData = stocks.find(s => s.type === p.type);
                const sisa = stockData ? (stockData.sisa_slot || stockData.stok || stockData.stock || 0) : 0;
                const ghostLevel = ghostLevels[p.type] || 0;
                
                // Align names by padding them to a fixed width
                const paddedName = p.nama.padEnd(10, ' ');
                let line = `- <code>${paddedName} : ${sisa} slot</code>`;
                if (ghostLevel > 0) {
                    line += ` <i>(⚠️ Ghost: ${ghostLevel})</i>`;
                }
                msg += line + '\n';
            });
            msg += '\n<pre>Catatan:\nJika angka stok sama dengan Ghost,\nbot akan melewati eksekusi.</pre>';
        } else {
            msg += 'Data stok tidak ditemukan atau kosong.';
        }
        ctx.reply(msg, { parse_mode: 'HTML', ...mainMenu });
    } catch (error) {
        ctx.reply('❌ Gagal mengambil data stok dari server.', { ...mainMenu });
        logger.error('Failed to get stock in bot', { error: error.message });
    }
});

bot.action(/detail_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const p = db.get('preorders').find({ id }).value();
    if (!p) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }
    
    let msg = `🔍 <b>DETAIL PRE-ORDER</b>\n\n`;
    msg += `<code>ID      : ${p.id}</code>\n`;
    msg += `<code>Nomor   : ${p.nomor}</code>\n`;
    msg += `<code>Paket   : ${p.nama_produk} (${p.kode_produk})</code>\n`;
    msg += `<code>Status  : ${p.status}</code>\n`;
    msg += `<code>Reff ID : ${p.reff_id}</code>\n`;
    msg += `<code>Ket     : ${p.keterangan || '-'}</code>\n`;
    msg += `---------------------------------------------------------\n`;
    msg += `Dibuat  : ${logger.formatDate(p.created_at)}`;
    
    await ctx.answerCbQuery();
    await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.action(/execmanual_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    logger.info(`User ${ctx.from.username} clicked EXEC (manual) for ID ${id}`);
    const p = db.get('preorders').find({ id }).value();
    if (!p) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }
    
    await ctx.answerCbQuery('Mengecek stok...', { show_alert: false });
    
    try {
        const stockRes = await api.cekStock();
        let stocks = [];
        if (Array.isArray(stockRes)) {
            stocks = stockRes;
        } else if (stockRes && Array.isArray(stockRes.data)) {
            stocks = stockRes.data;
        }

        const productStock = stocks.find(s => s.type === p.kode_produk || s.kode_produk === p.kode_produk);
        const sisaSlotStr = productStock ? (productStock.sisa_slot || productStock.stok || productStock.stock || 0) : 0;
        const sisaSlot = parseInt(sisaSlotStr, 10);

        if (sisaSlot <= 0) {
            return ctx.reply(`❌ Stok tidak tersedia untuk ${p.nama_produk}. Status tetap ${p.status}.`);
        }

        await ctx.reply(`🚀 Mengeksekusi transaksi manual untuk ${p.nomor}...`);

        const trxRes = await api.doTransaksi(p.kode_produk, p.nomor, p.reff_id);
        logger.info(`Manual Trx result for ${p.id}`, trxRes);
        
        if (trxRes.ok) {
            const isPeak = isPeakHour();
            const firstDelay = isPeak ? 5000 : 10000;

            db.get('preorders')
                .find({ id: p.id })
                .assign({
                    status: 'EXECUTED',
                    attempted_stock: sisaSlot,
                    keterangan: 'Manual: ' + (trxRes.msg || 'Akan diproses'),
                    updated_at: new Date().toISOString(),
                    next_status_check: Date.now() + firstDelay,
                    empty_check_count: 0
                })
                .write();
            
            // Auto-resume if successful
            const config = db.get('system_config').value() || { is_paused: false };
            if (config.is_paused) {
                db.set('system_config', { is_paused: false, pause_reason: '', last_pause_at: null }).write();
                logger.info('Bot auto-resumed due to successful manual execution');
            }

            ctx.reply(`🚀 Transaksi manual untuk ${p.nomor} terkirim. Status: EXECUTED.`);
        } else {
            const msg = (trxRes.msg || trxRes.error || '').toLowerCase();
            if (msg.includes('rate_limited')) {
                return ctx.reply('❌ Gagal: Terkena Rate Limit (4 trx/detik). Tunggu sebentar lagi.');
            }
            if (msg.includes('pending masih 2')) {
                return ctx.reply('❌ Gagal: Maksimal 2 transaksi pending tercapai. Tunggu transaksi lain selesai.');
            }
            if (msg.includes('stok kosong')) {
                const ghostLevels = db.get('ghost_levels').value() || {};
                ghostLevels[p.kode_produk] = sisaSlot;
                db.set('ghost_levels', ghostLevels).write();
                
                db.get('preorders')
                  .find({ id: p.id })
                  .assign({
                      keterangan: `Ghost Stock terdeteksi: ${sisaSlot}.`,
                      updated_at: new Date().toISOString()
                  })
                  .write();
                return ctx.reply(`❌ Gagal: Server mengonfirmasi stok kosong (Ghost Stock @ ${sisaSlot}).`);
            }

            if (msg.includes('saldo tidak mencukupi')) {
                db.get('preorders')
                  .find({ id: p.id })
                  .assign({
                      status: 'GAGAL',
                      keterangan: trxRes.msg,
                      updated_at: new Date().toISOString()
                  })
                  .write();
                return ctx.reply(`❌ Gagal: Saldo tidak mencukupi.`);
            }

            ctx.reply(`❌ Gagal mengeksekusi: ${trxRes.msg || trxRes.error}`);
        }

    } catch (error) {
        logger.error(`Manual Trx failed for ${p.id}`, error.message);
        ctx.reply(`❌ Transaksi manual gagal: ${error.message}`);
    }
});

bot.action(/cekbtn_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const p = db.get('preorders').find({ id }).value();
    if (!p) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }

    if (p.status === 'UNPROCESSED') {
        return ctx.answerCbQuery('Status masih UNPROCESSED. Belum ada transaksi di server.', { show_alert: true });
    }

    await ctx.answerCbQuery('Mengecek history di server...', { show_alert: false });

    try {
        const historyRes = await api.cekHistory(p.reff_id);
        ctx.reply(`🔍 Response Server untuk ${p.reff_id}:\n\n<pre>${JSON.stringify(historyRes, null, 2)}</pre>`, { parse_mode: 'HTML' });
    } catch (error) {
        ctx.reply(`❌ Gagal mengecek history: ${error.message}`);
    }
});

bot.action(/retrybtn_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const p = db.get('preorders').find({ id }).value();
    if (!p) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }

    const newReffId = generateReffId(p.nomor, p.kode_produk, p.nama_produk);
    db.get('preorders')
        .find({ id: p.id })
        .assign({
            reff_id: newReffId,
            status: 'UNPROCESSED',
            keterangan: 'Retried manually',
            updated_at: new Date().toISOString(),
            next_status_check: 0,
            empty_check_count: 0
        })
        .write();

    await ctx.answerCbQuery('🔄 Order di-reset ke UNPROCESSED dengan Reff ID baru.', { show_alert: true });
    
    const retryMsg = `🔄 <b>ORDER BERHASIL DI-RESET</b>\n\n` +
                     `<code>Nomor   : ${p.nomor}</code>\n` +
                     `<code>Status  : UNPROCESSED</code>\n` +
                     `<code>Reff ID : ${newReffId}</code>\n` +
                     `---------------------------------------------------------\n` +
                     `Waktu   : ${logger.formatDate(new Date().toISOString())}`;
    
    ctx.reply(retryMsg, { parse_mode: 'HTML' });
});

bot.action(/editbtn_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCbQuery();
    ctx.scene.enter('edit-preorder', { editId: id });
});

bot.action(/deletebtn_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const exists = db.get('preorders').find({ id }).value();
    if (!exists) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }
    
    db.get('preorders').remove({ id }).write();
    await ctx.answerCbQuery('✅ Pre-order berhasil dihapus.', { show_alert: true });
    try {
        await ctx.deleteMessage();
    } catch (e) {
        logger.warn('Failed to delete message', e);
    }
    logger.info('Preorder deleted via inline button', { id });
});

bot.command('tambah', (ctx) => ctx.scene.enter('add-preorder'));
bot.command('list', (ctx) => bot.handleUpdate({ ...ctx.update, message: { text: '📋 List' } }));
bot.command('hapus', (ctx) => ctx.scene.enter('delete-preorder'));
bot.command('edit', (ctx) => ctx.scene.enter('edit-preorder'));
bot.command('history', (ctx) => bot.handleUpdate({ ...ctx.update, message: { text: '📜 History' } }));

bot.command('exportlog', async (ctx) => {
    const botLogPath = path.join(__dirname, '..', 'bot.log');
    const apiLogPath = path.join(__dirname, '..', 'api.log');
    
    try {
        if (fs.existsSync(botLogPath)) {
            await ctx.replyWithDocument({ source: botLogPath });
        } else {
            await ctx.reply('❌ File bot.log tidak ditemukan.');
        }

        if (fs.existsSync(apiLogPath)) {
            await ctx.replyWithDocument({ source: apiLogPath });
        } else {
            await ctx.reply('❌ File api.log tidak ditemukan.');
        }
    } catch (err) {
        logger.error('Failed to export logs', err.message);
        ctx.reply('❌ Gagal mengeksport log: ' + err.message);
    }
});

module.exports = bot;
