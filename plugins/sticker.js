/**
 * plugins/sticker.js — bikin stiker dari gambar/video
 * Penggunaan: kirim/reply gambar atau video pendek + .s
 */
let Sticker, StickerTypes;
try {
  ({ Sticker, StickerTypes } = require('wa-sticker-formatter'));
} catch (_) { /* dependency belum terpasang -> handler akan inform */ }

module.exports = {
  command : ['s', 'sticker', 'stiker'],
  category: 'media',
  desc    : 'Convert gambar/video jadi stiker',
  handler : async ({ sock, m, reply }) => {
    if (!Sticker) return reply('Module wa-sticker-formatter belum terpasang. Jalankan `npm install`.');

    const target = m.quoted ?? m;
    const type = (m.quoted?.type || m.type || '');
    if (!/imageMessage|videoMessage/.test(type)) {
      return reply('Kirim/reply *gambar* atau *video pendek* dengan caption .s');
    }

    await sock.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });
    const buffer = await target.download();

    const sticker = new Sticker(buffer, {
      pack    : global.packname || 'Ryuuzaa MD',
      author  : global.author   || 'Bot',
      type    : StickerTypes.FULL,
      quality : 70
    });
    const out = await sticker.toBuffer();
    await sock.sendMessage(m.chat, { sticker: out }, { quoted: m });
    await sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
  }
};
