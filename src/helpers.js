// helpers.js
const fs = require('fs');
const path = require('path');


async function getBrowser() {
  if (browser) return browser;
  
  const CHROME_URL = process.env.CHROME_URL || 'http://127.0.0.1:9222';
  
  try {
    // Пытаемся подключиться к уже запущенному Chrome
    const response = await axios.get(`${CHROME_URL}/json/version`);
    const { webSocketDebuggerUrl } = response.data;
    
    browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
      defaultViewport: null
    });
    
    console.log('✅ Connected to existing Chrome instance');
    return browser;
  } catch (error) {
    console.log('❌ Failed to connect to Chrome:', error.message);
    
    // Если подключение не удалось, запускаем новый экземпляр
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    
    console.log('✅ Launched new Chrome instance');
    return browser;
  }
}

module.exports = {
  getBrowser,
};
