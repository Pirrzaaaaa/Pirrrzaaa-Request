/**
 * Entry point — auto-restart wrapper
 * Jalankan: `node index.js` atau `npm start`
 */
const { spawn } = require('child_process');
const path      = require('path');

let attempts = 0;

function start() {
  console.log('\x1b[35m%s\x1b[0m', `[BlackRose] Booting main.js (attempt #${++attempts})`);

  const child = spawn(process.execPath, [path.join(__dirname, 'main.js'), ...process.argv.slice(2)], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('message', msg => {
    if (msg === 'reset') {
      console.log('\x1b[33m%s\x1b[0m', '[BlackRose] Reset signal diterima, restart...');
      child.kill();
    }
    if (msg === 'uptime') child.send(process.uptime());
  });

  child.on('exit', code => {
    console.log('\x1b[31m%s\x1b[0m', `[BlackRose] Proses keluar dengan code ${code}, restart 3 detik...`);
    setTimeout(start, 3000);
  });
}

start();
