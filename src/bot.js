const { Telegraf, Scenes, session, Markup } = require('telegraf');
const db = require('./db');
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
    ['💰 Cek Saldo', '📦 Cek Stok']
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
                status: 'pending',
                reff_id: reff_id,
                trx_id: '',
                keterangan: '',
                created_at: new Date().toISOString()
            };
            
            db.get('preorders').push(newPreorder).write();
            
            ctx.reply(`✅ Pre-order berhasil ditambahkan!\n\n\`ID     :\` \`${newPreorder.id}\`\n\`Nomor  :\` \`${nomor}\`\n\`Paket  :\` \`${product.nama}\` (\`${product.type}\`)`, { parse_mode: 'Markdown', ...mainMenu });
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
        ctx.reply(`✅ Pre-order ID ${id} berhasil dihapus.`, mainMenu);
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
            ctx.reply(`✏️ Edit Pre-order ID: ${id}\nNomor lama: ${exists.nomor}\n\n<b>Masukkan nomor tujuan baru:</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
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
                  status: 'pending', // reset status
                  keterangan: 'Edited'
              })
              .write();
              
            ctx.reply(`✅ Pre-order ID ${id} berhasil diupdate.\n\n\`ID     :\` \`${id}\`\n\`Nomor  :\` \`${nomor}\`\n\`Paket  :\` \`${product.nama}\` (\`${product.type}\`)`, { parse_mode: 'Markdown', ...mainMenu });
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
    // We allow callback queries to pass if we can verify the user, 
    // but ctx.from is usually available in callbackQuery as well.
    const username = ctx.from?.username?.toLowerCase();
    if (username === 'kingbhe' || username === 'umams1') {
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
    
    // Check if it's a callback query to avoid error
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
        const msg = `\`ID     :\` \`${p.id}\`\n\`Nomor  :\` \`${p.nomor}\`\n\`Paket  :\` \`${p.nama_produk}\` (\`${p.kode_produk}\`)`;
        const buttons = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔍 Detail', `detail_${p.id}`),
                Markup.button.callback('🚀 Transac', `transac_${p.id}`)
            ],
            [
                Markup.button.callback('✏️ Edit', `editbtn_${p.id}`),
                Markup.button.callback('🗑️ Hapus', `deletebtn_${p.id}`)
            ]
        ]);
        await ctx.reply(msg, { parse_mode: 'Markdown', ...buttons });
    }
});

bot.hears('💰 Cek Saldo', (ctx) => {
    ctx.reply('💰 Saldo Anda saat ini: Rp 0\n\n*(Fitur dalam pengembangan)*', { parse_mode: 'Markdown', ...mainMenu });
});

bot.hears('📦 Cek Stok', async (ctx) => {
    try {
        const stockRes = await api.cekStock();
        const stocks = stockRes.data;
        
        let msg = '📦 Stok saat ini:\n\n';
        if (stocks && Array.isArray(stocks) && stocks.length > 0) {
            PRODUCTS.forEach(p => {
                const stockData = stocks.find(s => s.type === p.type);
                const sisa = stockData ? stockData.sisa_slot : p.sisa_slot;
                msg += `- ${p.nama} (${p.type}): ${sisa} slot\n`;
            });
        } else {
            msg += 'Data stok tidak ditemukan atau kosong.';
        }
        ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
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

bot.action(/transac_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const p = db.get('preorders').find({ id }).value();
    if (!p) {
        return ctx.answerCbQuery('❌ Pre-order tidak ditemukan.', { show_alert: true });
    }
    
    await ctx.answerCbQuery('Mengeksekusi transaksi manual...', { show_alert: false });
    
    try {
        const trxRes = await api.doTransaksi(p.kode_produk, p.nomor, p.reff_id);
        logger.info(`Manual Trx result for ${p.id}`, trxRes);
        
        const isFailedTrx = !trxRes || trxRes.ok === false || trxRes.status === false || (trxRes.message && trxRes.message.toLowerCase().includes('gagal'));

        if (isFailedTrx) {
            db.get('preorders')
              .find({ id: p.id })
              .assign({
                  status: 'error',
                  needsTrx: false,
                  keterangan: 'Manual Failed: ' + JSON.stringify(trxRes),
                  updated_at: new Date().toISOString()
              })
              .write();
              
            let msg = `⚠️ <b>TRANSAKSI MANUAL DITOLAK SERVER</b> ⚠️\n\n`;
            msg += `🆔 ID: <code>${p.id}</code>\n`;
            msg += `Response:\n<pre>${JSON.stringify(trxRes, null, 2)}</pre>\n\nStatus diubah ke <b>error</b>.`;
            
            await ctx.reply(msg, { parse_mode: 'HTML' });
        } else {
            db.get('preorders')
              .find({ id: p.id })
              .assign({
                  status: 'manual_retrying',
                  needsTrx: false,
                  keterangan: 'Manual: ' + JSON.stringify(trxRes),
                  updated_at: new Date().toISOString()
              })
              .write();
              
            let msg = `✅ <b>TRANSAKSI MANUAL TERKIRIM</b> ✅\n\n`;
            msg += `🆔 ID: <code>${p.id}</code>\n`;
            msg += `📱 Nomor: <code>${p.nomor}</code>\n`;
            msg += `📦 Paket: ${p.nama_produk} (${p.kode_produk})\n`;
            msg += `🔖 Reff ID: <code>${p.reff_id}</code>\n\n`;
            msg += `Response:\n<pre>${JSON.stringify(trxRes, null, 2)}</pre>\n\nStatus diubah ke <b>manual_retrying</b>.`;
            
            await ctx.reply(msg, { parse_mode: 'HTML' });
        }
    } catch (error) {
        logger.error(`Manual Trx failed for ${p.id}`, error.message);
        
        db.get('preorders')
          .find({ id: p.id })
          .assign({
              status: 'error',
              needsTrx: false,
              keterangan: 'Manual Error: ' + error.message,
              updated_at: new Date().toISOString()
          })
          .write();
          
        await ctx.reply(`❌ <b>TRANSAKSI MANUAL GAGAL/ERROR</b> ❌\n\nID: <code>${p.id}</code>\nError: ${error.message}\n\nStatus <b>error</b>.`, { parse_mode: 'HTML' });
    }
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
// We still keep the command text for manual entry or if users type it
bot.command('hapus', (ctx) => ctx.scene.enter('delete-preorder'));
bot.command('edit', (ctx) => ctx.scene.enter('edit-preorder'));

module.exports = bot;
