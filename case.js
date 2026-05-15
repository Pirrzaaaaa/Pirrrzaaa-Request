/**
 * case.js — Case-style handler (BlackRose / Lyfia / Adiwajshing legacy)
 * Return `true` untuk menghentikan pipeline (skip plugins).
 *
 * Tambahkan case kamu di blok switch.
 */
module.exports = async function caseHandler(ctx) {
  const { sock, m, command, args, text, isCmd, isOwner, reply } = ctx;
  if (!isCmd) return false;

  switch (command) {
    case 'halo':
    case 'hi':
      await reply(`Halo *${m.pushName || 'kak'}*! 🌹\nKetik *${ctx.usedPrefix}menu* untuk lihat fitur.`);
      return true;

    case 'echo': {
      if (!text) { await reply('Contoh: echo halo dunia'); return true; }
      await reply(text);
      return true;
    }

    case 'runtime': {
      const sec = Math.floor((Date.now() - global.startTime) / 1000);
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const mnt = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      await reply(`⏱️ Runtime: ${d}d ${h}h ${mnt}m ${s}s`);
      return true;
    }

    case 'eval': {
      if (!isOwner) { await reply(global.mess.owner); return true; }
      try {
        let res = await eval(`(async () => { ${text} })()`);
        if (typeof res !== 'string') res = require('util').inspect(res);
        await reply(res);
      } catch (e) {
        await reply(String(e));
      }
      return true;
    }

    default:
      return false; // lanjut ke plugin
  }
};
