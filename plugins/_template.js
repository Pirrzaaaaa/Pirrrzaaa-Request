/**
 * Template plugin (CommonJS / .js).
 * Salin & edit untuk membuat plugin baru.
 *
 * Field opsional:
 *   command  : string | string[] | RegExp
 *   category : string
 *   desc     : string
 *   owner    : boolean
 *   creator  : boolean   // creator only (isCreator true di config.owner)
 *   group    : boolean
 *   private  : boolean
 *   admin    : boolean
 *   botAdmin : boolean
 *
 * File yang diawali "_" akan diabaikan loader.
 */
module.exports = {
  command : 'template',
  category: 'misc',
  desc    : 'Contoh plugin',
  handler : async (ctx) => {
    await ctx.reply('Ini plugin template.');
  }
};
