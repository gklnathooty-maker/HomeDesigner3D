// Copies the built web app into www/ for Capacitor.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src'), out = path.join(__dirname, 'www');
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'app.bundle.js']) fs.copyFileSync(path.join(src, f), path.join(out, f));
console.log('web files copied to www/');
