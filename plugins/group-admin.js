/**
 * plugins/group-admin.js — kick / promote / demote
 * Penggunaan: reply / mention user, lalu .kick | .promote | .demote
 */
function targetJid(m, args) {
  if (m.quoted?.sender) return m.quoted.sender;
  if (m.mentionedJid?.length) return m.mentionedJid[0];
  if (args[0]) return args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  return null;
}

module.exports = [
  {
    command: 'kick',
    category: 'group',
    desc: 'Keluarkan member dari grup',
    group: true, admin: true, botAdmin: true,
    handler: async ({ sock, m, args, reply }) => {
      const jid = targetJid(m, args);
      if (!jid) return reply('Reply / mention / nomor user yang ingin di-kick.');
      await sock.groupParticipantsUpdate(m.chat, [jid], 'remove');
      await reply(`👢 ${jid.split('@')[0]} dikeluarkan.`);
    }
  },
  {
    command: 'promote',
    category: 'group',
    desc: 'Jadikan admin',
    group: true, admin: true, botAdmin: true,
    handler: async ({ sock, m, args, reply }) => {
      const jid = targetJid(m, args);
      if (!jid) return reply('Reply / mention user.');
      await sock.groupParticipantsUpdate(m.chat, [jid], 'promote');
      await reply(`⬆️ ${jid.split('@')[0]} dipromosikan.`);
    }
  },
  {
    command: 'demote',
    category: 'group',
    desc: 'Turunkan admin',
    group: true, admin: true, botAdmin: true,
    handler: async ({ sock, m, args, reply }) => {
      const jid = targetJid(m, args);
      if (!jid) return reply('Reply / mention user.');
      await sock.groupParticipantsUpdate(m.chat, [jid], 'demote');
      await reply(`⬇️ ${jid.split('@')[0]} diturunkan.`);
    }
  }
];
