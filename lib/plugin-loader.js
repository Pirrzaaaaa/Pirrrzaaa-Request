/**
 * lib/plugin-loader.js
 * Hybrid loader untuk plugin CommonJS (.cjs/.js) DAN ESM (.mjs/.js dengan export default).
 *
 * Plugin shape:
 *   module.exports = {
 *     command : 'ping' | ['ping','p'] | /^ping$/i,
 *     category: 'tools',
 *     desc    : 'Ping bot',
 *     owner   : false,
 *     group   : false,
 *     admin   : false,
 *     botAdmin: false,
 *     handler : async (ctx) => { ... }
 *   };
 *
 * ESM (.mjs):
 *   export default {
 *     command: 'foo',
 *     handler: async (ctx) => { ... }
 *   };
 */
const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');
const { pathToFileURL } = require('url');

class PluginLoader {
  constructor(rootDir) {
    this.rootDir = rootDir;
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
  }

  _walk(dir, list = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) this._walk(full, list);
      else if (/\.(c?js|mjs)$/i.test(entry.name) && !entry.name.startsWith('_')) list.push(full);
    }
    return list;
  }

  async _loadOne(file) {
    const ext = path.extname(file).toLowerCase();
    let mod;

    try {
      if (ext === '.mjs') {
        // ESM
        const url = pathToFileURL(file).href + `?t=${Date.now()}`;
        mod = await import(url);
        mod = mod.default || mod;
      } else if (ext === '.cjs' || ext === '.js') {
        // CommonJS (clear cache for hot reload)
        delete require.cache[require.resolve(file)];
        mod = require(file);
        if (mod && typeof mod === 'object' && mod.default && !mod.command && !mod.handler) {
          mod = mod.default; // tolerate ESM-shaped CJS
        }
      } else {
        return null;
      }
    } catch (e) {
      console.log(chalk.red(`✗ Gagal load plugin ${path.basename(file)}: ${e.message}`));
      return null;
    }

    const baseName = path.relative(this.rootDir, file);

    // Hapus entri lama dari file ini (untuk hot-reload array plugin)
    for (const key of Array.from(global.plugins.keys())) {
      if (key === baseName || key.startsWith(baseName + '#')) global.plugins.delete(key);
    }

    const items = Array.isArray(mod) ? mod : [mod];
    let added = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || (!it.command && !it.handler && !it.run)) continue;
      const key = items.length === 1 ? baseName : `${baseName}#${i}`;
      global.plugins.set(key, it);
      added++;
    }

    if (!added) return null;
    global.pluginCache.set(file, fs.statSync(file).mtimeMs);
    return baseName;
  }

  async loadAll() {
    global.plugins.clear();
    const files = this._walk(this.rootDir);
    for (const f of files) await this._loadOne(f);
  }

  watch() {
    fs.watch(this.rootDir, { recursive: true }, async (event, filename) => {
      if (!filename) return;
      const full = path.join(this.rootDir, filename);
      if (!/\.(c?js|mjs)$/i.test(filename)) return;

      // file dihapus
      if (!fs.existsSync(full)) {
        for (const [name] of global.plugins) {
          if (name === filename) {
            global.plugins.delete(name);
            console.log(chalk.gray(`− plugin dihapus: ${name}`));
          }
        }
        global.pluginCache.delete(full);
        return;
      }

      // dedup mtime
      const mtime = fs.statSync(full).mtimeMs;
      if (global.pluginCache.get(full) === mtime) return;

      const name = await this._loadOne(full);
      if (name) console.log(chalk.green(`↻ plugin reloaded: ${name}`));
    });
  }
}

module.exports = PluginLoader;
