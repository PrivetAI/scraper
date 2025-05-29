// helpers.js
const fs = require('fs');
const path = require('path');

const STORAGE_FILE = path.resolve(__dirname, 'storage.json');
const COOKIES_FILE = path.resolve(__dirname, 'cookies.json');

async function dumpDebug(page, label) {
  const ts = Date.now();
  const shot = path.resolve(__dirname, `../report/debug-${label}-${ts}.png`);
  const htmlf = path.resolve(__dirname, `../report/debug-${label}-${ts}.html`);
  try {
    await page.screenshot({ path: shot, fullPage: true });
    fs.writeFileSync(htmlf, await page.content(), 'utf8');
    console.log(`🛠 Debug saved: ${shot}, ${htmlf}`);
  } catch (e) {
    console.warn('⚠️ dumpDebug failed:', e.message);
  }
}

async function loadCookiesObject(cookiesObject) {
  if (cookiesObject && typeof cookiesObject === 'object') {
    return Object.entries(cookiesObject).map(([name, value]) => ({
      name, value: String(value), domain: '.hh.ru', path: '/'
    }));
  }
  if (!fs.existsSync(COOKIES_FILE)) {
    throw new Error('cookies.json not found and no COOKIES_OBJECT provided');
  }
  const data = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    return Object.entries(data).map(([n,v])=>({
      name: n, value: String(v), domain: '.hh.ru', path: '/'
    }));
  }
  throw new Error('cookies.json has unsupported format');
}

async function saveStorage(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  const ls = await page.evaluate(() => JSON.stringify(localStorage));
  fs.writeFileSync(STORAGE_FILE, ls, 'utf8');
  console.log('💾 Storage saved');
}

async function loadStorage(page, cookiesObject) {
  const cookies = await loadCookiesObject(cookiesObject);
  await page.setCookie(...cookies);
  if (fs.existsSync(STORAGE_FILE)) {
    const store = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    // inject before any script runs
    await page.evaluateOnNewDocument(s=>{
      for(const [k,v] of Object.entries(s)){
        try{ localStorage.setItem(k,v); }catch{}
      }
    }, store);
    console.log('🔄 localStorage will be restored');
  }
}


module.exports = {
  dumpDebug,
  loadCookiesObject,
  saveStorage,
  loadStorage,
};
