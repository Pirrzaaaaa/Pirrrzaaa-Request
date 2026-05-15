/**
 * Konfigurasi Bot
 * Edit nilai di bawah sesuai kebutuhan kamu.
 */

global.owner = [
  ['628xxxxxxxxxx', 'Pirrzaaaaa', true] // [nomor, nama, isCreator]
];

global.botName  = 'BlackRose-Bot';
global.ownerName = 'Pirrzaaaaa';
global.prefix    = ['.', '!', '/', '#']; // multi-prefix; set false untuk no-prefix
global.packname  = 'BlackRose';
global.author    = 'Pirrzaaaaa';

// Pesan default
global.mess = {
  wait    : '⏳ Sedang diproses, mohon tunggu...',
  success : '✅ Berhasil!',
  error   : '❌ Terjadi kesalahan.',
  owner   : '🚫 Khusus owner bot.',
  group   : '👥 Khusus di dalam grup.',
  private : '🔒 Khusus di chat pribadi.',
  admin   : '🔱 Khusus admin grup.',
  botAdmin: '🤖 Bot harus jadi admin grup dulu.',
  premium : '💎 Khusus user premium.'
};

// Timezone tampilan
global.timezone = 'Asia/Jakarta';

// API key (kalau ada)
global.APIs = {
  // contoh: lol: 'https://api.lolhuman.xyz'
};
global.APIKeys = {
  // 'https://api.lolhuman.xyz': 'apikeykamu'
};

// Reload otomatis saat file plugin berubah
global.autoReload = true;

module.exports = {
  sessionName: 'session',
  storeFile  : 'baileys_store.json',
  databaseFile: './database/database.sqlite',
  pluginsDir : './plugins',
  caseFile   : './case.js'
};
