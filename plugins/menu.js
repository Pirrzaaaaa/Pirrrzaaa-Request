/**
 * plugins/menu.js — daftar semua command (auto dari plugin yang di-load)
 */
module.exports = {
  command : ['menu', 'help'],
  category: 'main',
  desc    : 'Tampilkan menu bot',
  handler : async (ctx) => {
    const { usedPrefix, m, reply } = ctx;
    const buckets = {};

    for (const [, plugin] of global.plugins) {
      const cat = plugin.category || 'misc';
      const cmd = Array.isArray(plugin.command) ? plugin.command[0]
                : plugin.command instanceof RegExp ? plugin.command.toString()
                : plugin.command;
      if (!cmd) continue;
      buckets[cat] = buckets[cat] || [];
      buckets[cat].push({ cmd, desc: plugin.desc || '' });
    }

    let text = `╭───「 *${global.botName}* 」\n`;
    text += `│ Halo *${m.pushName || 'kak'}*!\n`;
    text += `│ Prefix: ${(global.prefix || []).join(' ')}\n`;
    text += `╰────────────\n\n`;

    for (const cat of Object.keys(buckets).sort()) {
      text += `╭─❲ *${cat.toUpperCase()}* ❳\n`;
      for (const it of buckets[cat]) text += `│ • ${usedPrefix}${it.cmd}${it.desc ? ` — ${it.desc}` : ''}\n`;
      text += `╰────────────\n`;
    }

    text += `\n_Case-handler aktif: halo, hi, echo, runtime, eval_`;
    await reply(text);
  }
};
