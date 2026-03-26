const { startChecker } = require('./src/checker');
startChecker({
  telegram: {
    sendMessage: async (chatId, msg) => {
      console.log(`[Telegram -> ${chatId}]: ${msg}`);
    }
  }
}, 10000);
