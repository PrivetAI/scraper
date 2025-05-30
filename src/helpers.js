const puppeteer = require('puppeteer-core');
const axios = require('axios');

let browser = null;

async function getBrowser() {
  if (browser) return browser;
  
  const CHROME_URL = process.env.CHROME_URL || 'http://host.docker.internal:9222';
  const USE_REMOTE_CHROME = process.env.USE_REMOTE_CHROME !== 'false';
  
  if (USE_REMOTE_CHROME) {
    try {
      console.log(`🔗 Trying to connect to Chrome at ${CHROME_URL}`);
      const response = await axios.get(`${CHROME_URL}/json/version`, { timeout: 5000 });
      const { webSocketDebuggerUrl } = response.data;
      
      browser = await puppeteer.connect({
        browserWSEndpoint: webSocketDebuggerUrl,
        defaultViewport: { width: 1280, height: 800 }
      });
      
      console.log('✅ Connected to existing Chrome instance');
      return browser;
    } catch (error) {
      console.log('❌ Failed to connect to remote Chrome:', error.message);
    }
  }
  
  const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  
  console.log('✅ Launched new Chrome instance');
  return browser;
}

module.exports = {
  getBrowser,
};