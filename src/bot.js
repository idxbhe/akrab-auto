const { Telegraf, Scenes, session, Markup } = require('telegraf');
const db = require('./db');
const logger = require('./logger');
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

const addPreorderWizard = new Scenes.WizardScene(
    'add-preorder',
    (ctx) => {
        ctx.reply('Masukkan nomor tujuan:');
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) {
             ctx.reply('Harap masukkan teks nomor tujuan:');
             return;
        }
        ctx.wizard.state.nomor = ctx.message.text;
        
        const buttons = PRODUCTS.map(p => Markup.button.callback(`${p.nama} (${p.type})`, `select_${p.type}`));
        const keyboard = Markup.inlineKeyboard(buttons, { columns: 2 });
        
        ctx.reply('Pilih paket Akrab:', keyboard);
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.callbackQuery) return;
        
        const data = ctx.callbackQuery.data;
        if (data.startsWith('select_')) {
            const kode = data.split('_')[1];
            const product = PRODUCTS.find(p => p.type === kode);
            if (!product) {
                ctx.reply('Produk tidak ditemukan, ulangi proses.');
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
            
            ctx.reply(`Pre-order berhasil ditambahkan!\nNomor: ${nomor}\nPaket: ${product.nama}\nReff ID: ${reff_id}`);
            logger.info('Preorder added', newPreorder);
            ctx.answerCbQuery();
            return ctx.scene.leave();
        }
    }
);

const stage = new Scenes.Stage([addPreorderWizard]);

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

// Security middleware
bot.use((ctx, next) => {
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
    return ctx.reply('Anda tidak memiliki akses ke bot ini.');
});

bot.command('start', (ctx) => {
    ctx.reply('Selamat datang di Bot Pre-Order Kuota Akrab.\n\n/tambah - Tambah pre-order\n/list - Lihat daftar pre-order\n/hapus [id] - Hapus pre-order\n/edit [id] [nomor] [kodeproduk] - Edit pre-order');
});

bot.command('tambah', (ctx) => {
    ctx.scene.enter('add-preorder');
});

bot.command('list', (ctx) => {
    const preorders = db.get('preorders').value();
    if (!preorders || preorders.length === 0) {
        return ctx.reply('Daftar pre-order kosong.');
    }
    
    let msg = 'Daftar Pre-Order:\n\n';
    preorders.forEach(p => {
        msg += `ID: ${p.id}\n`;
        msg += `Nomor: ${p.nomor}\n`;
        msg += `Paket: ${p.nama_produk} (${p.kode_produk})\n`;
        msg += `Status: ${p.status}\n`;
        msg += `Reff ID: ${p.reff_id}\n`;
        msg += `Keterangan: ${p.keterangan || '-'}\n\n`;
    });
    
    // Split message if too long for Telegram
    const maxLength = 4000;
    for (let i = 0; i < msg.length; i += maxLength) {
        ctx.reply(msg.substring(i, i + maxLength));
    }
});

bot.command('hapus', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Format salah. Gunakan: /hapus [id]');
    }
    const id = args[1];
    
    const exists = db.get('preorders').find({ id }).value();
    if (!exists) {
        return ctx.reply('Pre-order tidak ditemukan.');
    }
    
    db.get('preorders').remove({ id }).write();
    ctx.reply(`Pre-order ID ${id} berhasil dihapus.`);
    logger.info('Preorder deleted', { id });
});

bot.command('edit', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
        return ctx.reply('Format salah. Gunakan: /edit [id] [nomor] [kodeproduk]');
    }
    const id = args[1];
    const nomor = args[2];
    const kode_produk = args[3];
    
    const exists = db.get('preorders').find({ id }).value();
    if (!exists) {
        return ctx.reply('Pre-order tidak ditemukan.');
    }
    
    const product = PRODUCTS.find(p => p.type === kode_produk);
    if (!product) {
        return ctx.reply('Kode produk tidak valid. Gunakan XLA14, XLA32, dsb.');
    }
    
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
      
    ctx.reply(`Pre-order ID ${id} berhasil diupdate.\nNomor: ${nomor}\nPaket: ${product.nama}\nReff ID Baru: ${newReffId}`);
    logger.info('Preorder edited', { id, nomor, kode_produk });
});

module.exports = bot;
