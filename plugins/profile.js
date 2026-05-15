/**
 * plugins/profile.js — info profil user dari DB SQLite
 */
module.exports = [
  {
    command : ['profile', 'me'],
    category: 'user',
    desc    : 'Lihat profil kamu',
    handler : async ({ db, m, reply }) => {
      db.ensureUser(m.sender, m.pushName);
      const u = db.getUser(m.sender);
      const txt =
`👤 *Profile*
• Nama   : ${u.name || m.pushName || '-'}
• Level  : ${u.level}
• XP     : ${u.exp}
• Money  : ${u.money}
• Premium: ${u.premium ? 'Ya' : 'Tidak'}`;
      await reply(txt);
    }
  },
  {
    command : 'daily',
    category: 'user',
    desc    : 'Klaim reward harian (+100 money, +50 xp)',
    handler : async ({ db, m, reply }) => {
      db.ensureUser(m.sender, m.pushName);
      const last = parseInt(db.getSetting(`daily:${m.sender}`, '0'), 10);
      const now  = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      if (now - last < dayMs) {
        const remain = Math.ceil((dayMs - (now - last)) / 1000 / 60 / 60);
        return reply(`⏳ Sudah klaim. Coba lagi ~${remain} jam.`);
      }
      db.addMoney(m.sender, 100);
      db.addExp(m.sender, 50);
      db.setSetting(`daily:${m.sender}`, String(now));
      await reply('🎁 +100 money, +50 xp!');
    }
  }
];
