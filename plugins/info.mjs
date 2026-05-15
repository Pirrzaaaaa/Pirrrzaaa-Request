// plugins/info.mjs — contoh plugin format ESM (.mjs)
export default {
  command : ['info', 'botinfo'],
  category: 'info',
  desc    : 'Tampilkan info bot',
  handler : async (ctx) => {
    const { db, reply } = ctx;
    const sec = Math.floor((Date.now() - global.startTime) / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mem = process.memoryUsage();
    const stats = db.stats();

    const txt =
`╭─❲ *${global.botName}* ❳
│ 👤 Owner   : ${global.ownerName}
│ ⏱️ Runtime : ${d}d ${h}h ${m}m ${s}s
│ 🧩 Plugins : ${global.plugins.size}
│ 👥 Users   : ${stats.users}
│ 💬 Groups  : ${stats.groups}
│ 🧠 Memory  : ${(mem.rss/1024/1024).toFixed(1)} MB
│ ⚙️ Node    : ${process.version}
╰────────────`;
    await reply(txt);
  }
};
