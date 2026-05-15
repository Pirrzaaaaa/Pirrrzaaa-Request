/**
 * plugins/ping.cjs — contoh plugin format CommonJS (.cjs)
 */
module.exports = {
  command : ['ping', 'p'],
  category: 'tools',
  desc    : 'Cek latency bot',
  handler : async ({ reply }) => {
    const start = Date.now();
    await reply('🏓 Pong!');
    const ms = Date.now() - start;
    await reply(`Latency: *${ms} ms*`);
  }
};
