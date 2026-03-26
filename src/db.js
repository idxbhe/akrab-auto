const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, '..', 'db.json'));
const db = low(adapter);

// Set some defaults (required if your JSON file is empty)
db.defaults({ 
    preorders: [],
    admin_chats: []
})
  .write();

module.exports = db;
