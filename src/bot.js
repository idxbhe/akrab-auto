const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { db, historyDb } = require('./db');
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

function generateReffId(nomor, kode_produk, nama_produk) {
    const uid = Math.random().toString(36).substring(2, 8);
    return `${nomor}-${kode_produk}-${nama_produk.replace(/\s+/g, '')}-${uid}`;
}

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
            
            ctx.reply(`✅ Pre-order berhasil ditambahkan!\n\n\`Nomor  :\` \`${nomor}\`\n\`Paket  :\` \`${product.nama}\` (\`${product.type}\`)\n\`Status :\` \`UNPROCESSED\``, { parse_mode: 'Markdown', ...mainMenu });
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
              
            ctx.reply(`✅ Pre-order berhasil diupdate.\n\n\`Nomor  :\` \`${nomor}\`\n\`Paket  :\` \`${product.nama}\` (\`${product.type}\`)\n\`Status :\` \`UNPROCESSED\``, { parse_mode: 'Markdown', ...mainMenu });
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

bot.command('start', (ctx) => {
    ctx.reply('👋 Selamat datang di Bot Pre-Order Kuota Akrab.\n\nSilakan pilih menu di bawah ini:', mainMenu);
});

bot.hears('➕ Tambah', (ctx) => {
    ctx.scene.enter('add-preorder');
});

bot.hears('📋 List', async (ctx) => {
    const preorders = db.get('preorders').value();
    if (!preorders || preorders.length === 0) {
        return ctx.reply('📭 Daftar pre-order kosong.', mainMenu);
    }
    
    ctx.reply('📋 Daftar Pre-Order:', mainMenu);
    
    for (const p of preorders) {
        const msg = `\`Nomor  :\` \`${p.nomor}\`\n\`Paket  :\` \`${p.nama_produk}\` (\`${p.kode_produk}\`)\n\`Status :\` \`${p.status}\``;
        
        const row1 = [
            Markup.button.callback('🔍 Detail', `detail_${p.id}`),
            Markup.button.callback('🚀 EXEC (manual)', `execmanual_${p.id}`)
        ];
        const row2 = [
            Markup.button.callback('✏️ Edit', `editbtn_${p.id}`),
            Markup.button.callback('🗑️ Hapus', `deletebtn_${p.id}`)
        ];
        const row3 = [
            Markup.button.callback('🔄 Cek', `cekbtn_${p.id}`)
        ];

        if (p.status === 'ERROR') {
            row3.push(Markup.button.callback('♻️ Retry', `retrybtn_${p.id}`));
        }

        const buttons = Markup.inlineKeyboard([row1, row2, row3]);
        await ctx.reply(msg, { parse_mode: 'Markdown', ...buttons });
    }
});

bot.hears('📜 History', async (ctx) => {
    const history = historyDb.get('history').orderBy(['updated_at'], ['desc']).take(5).value();
    if (!history || history.length === 0) {
        return ctx.reply('📜 History kosong.', mainMenu);
    }

    let msg = '📜 **5 History Terakhir (SUCCESS):**\n\n';
    history.forEach((p, i) => {
        msg += `${i+1}. \`${p.nomor}\` - ${p.nama_produk}\n   📅 ${p.updated_at}\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

bot.hears('📦 Cek Stok', async (ctx) => {
    try {
        const stockRes = await api.cekStock();
        const stocks = stockRes.data;
        const ghostLevels = db.get('ghost_levels').value() || {};
        
        let msg = '📦 <b>Stok saat ini:</b>\n\n';
        if (stocks && Array.isArray(stocks) && stocks.length > 0) {
            PRODUCTS.forEach(p => {
                const stockData = stocks.find(s => s.type === p.type);
                const sisa = stockData ? (stockData.sisa_slot || stockData.stok || stockData.stock || 0) : 0;
                const ghostLevel = ghostLevels[p.type] || 0;
                
                let line = `- ${p.nama} (${p.type}): <b>${sisa} slot</b>`;
                if (ghostLevel > 0) {
                    line += ` ⚠️ <i>(Ghost: ${ghostLevel})</i>`;
                }
                msg += line + '\n';
            });
            msg += '\n<i>Catatan: Jika angka stok sama dengan Ghost, bot akan melewati eksekusi.</i>';
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
    
    let msg = `🔍 Detail Pre-Order:\n\n`;
    msg += `\`ID     :\` \`${p.id}\`\n`;
    msg += `\`Nomor  :\` \`${p.nomor}\`\n`;
    msg += `\`Paket  :\` \`${p.nama_produk}\` (\`${p.kode_produk}\`)\n`;
    msg += `\`Status :\` \`${p.status}\`\n`;
    msg += `\`Reff ID:\` \`${p.reff_id}\`\n`;
    msg += `\`Ket.   :\` \`${p.keterangan || '-'}\`\n`;
    msg += `\`Dibuat :\` \`${p.created_at}\``;
    
    await ctx.answerCbQuery();
    await ctx.reply(msg, { parse_mode: 'Markdown' });
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
        
        db.get('preorders')
            .find({ id: p.id })
            .assign({
                status: 'EXECUTED',
                attempted_stock: sisaSlot,
                keterangan: 'Manual: ' + (trxRes.msg || trxRes.message || JSON.stringify(trxRes)),
                updated_at: new Date().toISOString(),
                next_status_check: Date.now() + 10000,
                empty_check_count: 0
            })
            .write();
        
        ctx.reply(`✅ Transaksi manual terkirim. Status diubah ke **EXECUTED**. Menunggu webhook...`, { parse_mode: 'Markdown' });

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
    ctx.reply(`🔄 Order \`${p.nomor}\` di-reset ke **UNPROCESSED**.\nReff ID baru: \`${newReffId}\``, { parse_mode: 'Markdown' });
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

module.exports = bot;
