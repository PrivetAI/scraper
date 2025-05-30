const puppeteer = require('puppeteer-core');
const axios = require('axios');

let browser = null;

async function getBrowser() {
  if (browser) return browser;
  
  const CHROME_URL = process.env.CHROME_URL || 'http://host.docker.internal:9222';
  const USE_REMOTE_CHROME = process.env.USE_REMOTE_CHROME !== 'false';
  
  if (USE_REMOTE_CHROME) {
    try {
      console.log(`🔗 Connecting to Chrome at ${CHROME_URL}`);
      const response = await axios.get(`${CHROME_URL}/json/version`, { timeout: 5000 });
      const { webSocketDebuggerUrl } = response.data;
      
      browser = await puppeteer.connect({
        browserWSEndpoint: webSocketDebuggerUrl,
        defaultViewport: { 
          width: parseInt(process.env.VIEWPORT_WIDTH) || 1280, 
          height: parseInt(process.env.VIEWPORT_HEIGHT) || 800 
        }
      });
      
      console.log('✅ Connected to remote Chrome');
      return browser;
    } catch (error) {
      console.error('❌ Failed to connect to remote Chrome:', error.message);
      throw error;
    }
  }
  
  throw new Error('Remote Chrome connection required but failed');
}

module.exports = { getBrowser };