const bot = require('./src/bot');
const { startChecker } = require('./src/checker');
const logger = require('./src/logger');
const dotenv = require('dotenv');
dotenv.config();

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '10000', 10);

bot.launch().then(() => {
    logger.info('Bot is running...');
    startChecker(bot, CHECK_INTERVAL);
}).catch(err => {
    logger.error('Failed to start bot', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
