/**
 * plugins/group-welcome.js — toggle welcome/leave message
 * Penggunaan: .welcome on / .welcome off  (admin grup)
 */
module.exports = {
  command : 'welcome',
  category: 'group',
  desc    : 'Aktifkan/nonaktifkan welcome message',
  group   : true,
  admin   : true,
  handler : async ({ db, m, args, reply }) => {
    const arg = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) return reply('Penggunaan: .welcome on | .welcome off');
    db.ensureGroup(m.chat);
    db.setGroup(m.chat, 'welcome', arg === 'on' ? 1 : 0);
    await reply(`✅ Welcome message: *${arg.toUpperCase()}*`);
  }
};
