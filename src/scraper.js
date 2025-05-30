const puppeteerExtra = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
const { getBrowser } = require("./helpers");

puppeteerExtra.use(Stealth());

const pages = new Map();

async function safeGoto(page, url, opts = {}) {
  const defaultOpts = { 
    waitUntil: "domcontentloaded", 
    timeout: 30000,
    ...opts 
  };
  
  console.log(`🌐 Navigating to: ${url}`);
  
  for (let i = 0; i < 3; i++) {
    try {
      const response = await page.goto(url, defaultOpts);
      console.log(`✅ Navigation successful, status: ${response.status()}`);
      return response;
    } catch (e) {
      console.warn(`⚠️ Navigation attempt ${i + 1} failed:`, e.message);
      if (e.message.includes("ERR_NETWORK_CHANGED") && i < 2) {
        await page.waitForTimeout(1000 * (i + 1));
        continue;
      }
      if (i === 2) throw e;
      await page.waitForTimeout(2000);
    }
  }
}

function extractVacancyId(url) {
  const match = url.match(/vacancy\/(\d+)/);
  return match ? match[1] : null;
}

function randomDelay(min = 100, max = 300) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

async function extractSalaryInfo(page) {
  const selectors = [
    '[data-qa="vacancy-salary"]',
    '.vacancy-salary',
    '[data-qa="vacancy-title-salary"]'
  ];
  
  for (const sel of selectors) {
    try {
      const salaryEl = await page.$(sel);
      if (!salaryEl) continue;
      const salaryText = await salaryEl.evaluate(el => el.innerText.trim());
      if (salaryText && !salaryText.toLowerCase().includes('не указан')) {
        return salaryText;
      }
    } catch {}
  }
  return null;
}

async function extractWorkFormat(page) {
  const selectors = [
    '[data-qa="vacancy-view-employment-mode"]',
    '[data-qa="vacancy-view-employment"]',
    '.vacancy-description-list-item'
  ];
  
  const formats = [];
  
  for (const sel of selectors) {
    try {
      const elements = await page.$$(sel);
      for (const el of elements) {
        const text = await el.evaluate(e => e.innerText.trim());
        if (text) formats.push(text);
      }
    } catch {}
  }
  
  return formats.join(', ') || null;
}

async function extractVacancyDetails(page) {
  const expandBtn = await page.$('[data-qa="vacancy-description-toggle-button"]');
  if (expandBtn) {
    try {
      await expandBtn.click();
      await page.waitForTimeout(500);
    } catch {}
  }

  const descSelectors = [
    '[data-qa="vacancy-description"]',
    '#vacancy-description__text',
    '.vacancy-description'
  ];

  let description = '';
  for (const sel of descSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2000 });
      description = await page.$eval(sel, el => el.innerText.trim());
      if (description) break;
    } catch {}
  }

  const getTextBySel = async (sel, fallback = '') => {
    try {
      return await page.$eval(sel, el => el.innerText.trim());
    } catch {
      return fallback;
    }
  };

  const [title, company, location, salary, workFormat] = await Promise.all([
    getTextBySel('[data-qa="vacancy-title"]'),
    getTextBySel('[data-qa="vacancy-company-name"]'),
    getTextBySel('[data-qa="vacancy-view-location"]'),
    extractSalaryInfo(page),
    extractWorkFormat(page)
  ]);

  return {
    title,
    company,
    location,
    salary,
    work_format: workFormat,
    description: description || 'Описание не найдено'
  };
}

async function applyOnPage(page, coverLetterText) {
  const alreadyResponded = await page.$x("//div[contains(., 'Вы откликнулись')]");
  if (alreadyResponded.length > 0) {
    return { success: false, skipped: true };
  }

  const [initBtn] = await page.$x("//span[contains(text(),'Откликнуться')]");
  if (!initBtn) throw new Error("Apply button not found");

  let redirected = false;
  await Promise.all([
    initBtn.click(),
    page.waitForNavigation({ timeout: 3000 })
      .then(() => { redirected = true; })
      .catch(() => {})
  ]);

  if (redirected) return { success: false };

  await page.waitForTimeout(500);

  const relocationSel = '[data-qa="relocation-warning-confirm"]';
  if (await page.$(relocationSel)) {
    await Promise.all([
      page.click(relocationSel),
      page.waitForNavigation({ timeout: 1000 })
        .then(() => { redirected = true; })
        .catch(() => {})
    ]);
    if (redirected) return { success: false };
    await page.waitForTimeout(500);
  }

  await page.waitForSelector('form[name="vacancy_response"]', { visible: true, timeout: 1000 });
  await page.waitForTimeout(300);

  const addBtnSel = 'button[data-qa="add-cover-letter"]';
  const addBtn = await page.waitForSelector(addBtnSel, { visible: true, timeout: 1000 }).catch(() => null);
  if (addBtn) {
    await addBtn.evaluate(el => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    await addBtn.click({ delay: 50 });
    await page.waitForTimeout(500);
  }

  const textareaSel = 'textarea[data-qa="vacancy-response-popup-form-letter-input"]';
  await page.waitForSelector(textareaSel, { visible: true, timeout: 2000 });
  await page.focus(textareaSel);
  await page.waitForTimeout(randomDelay());
  
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(randomDelay());

  for (const char of coverLetterText) {
    await page.type(textareaSel, char, { delay: randomDelay(5, 15) });
  }
  await page.waitForTimeout(randomDelay(200, 500));

  const submitSel = 'button[data-qa="vacancy-response-submit-popup"]';
  await page.waitForSelector(`${submitSel}:not([disabled])`, { visible: true, timeout: 2000 });
  await page.click(submitSel);

  return { success: true };
}

async function scrapeVacancy(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  
  await safeGoto(page, url);
  
  const vacancyId = extractVacancyId(url);
  const details = await extractVacancyDetails(page);
  
  pages.set(vacancyId, page);
  
  return { vacancyId, url, ...details };
}

async function applyToVacancy(vacancyId, coverLetterText) {
  const page = pages.get(vacancyId);
  if (!page) throw new Error(`Page for ${vacancyId} not found`);
  
  const result = await applyOnPage(page, coverLetterText);
  await page.close();
  pages.delete(vacancyId);
  
  return result;
}

async function scrapeVacancyList(url) {
  console.log(`🔍 Starting vacancy list scraping for: ${url}`);
  
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  
  console.log('📄 Creating new page...');
  
  await safeGoto(page, url);
  
  console.log('📜 Starting scroll to load all vacancies...');
  
  try {
    await page.evaluate(async () => {
      const distance = 100;
      const delay = 100;
      let lastHeight = document.scrollingElement.scrollHeight;
      let scrollCount = 0;
      
      while (scrollCount < 50) { // максимум 50 скроллов
        document.scrollingElement.scrollBy(0, distance);
        await new Promise(r => setTimeout(r, delay));
        
        const newHeight = document.scrollingElement.scrollHeight;
        if (newHeight === lastHeight) {
          break;
        }
        lastHeight = newHeight;
        scrollCount++;
      }
      
      console.log(`Scrolled ${scrollCount} times`);
    });
  } catch (e) {
    console.warn('⚠️ Scroll error:', e.message);
  }

  console.log('🎯 Waiting for vacancy elements...');
  
  try {
    await page.waitForSelector('[data-qa^="vacancy-serp__vacancy"]', { timeout: 10000 });
  } catch (e) {
    console.error('❌ No vacancy elements found:', e.message);
    await page.close();
    throw new Error('No vacancy elements found on page');
  }

  console.log('📊 Extracting vacancy data...');

  const vacancies = await page.$$eval('[data-qa^="vacancy-serp__vacancy"]', nodes =>
    nodes.map(node => {
      const link = node.querySelector('a[data-qa="serp-item__title"]');
      if (!link) return null;

      const url = link.href;
      const title = link.querySelector('[data-qa="serp-item__title-text"]')?.innerText.trim() || '';
      const company = node.querySelector('[data-qa="vacancy-serp__vacancy-employer"]')?.innerText.trim() || '';
      const location = node.querySelector('[data-qa="vacancy-serp__vacancy-address"]')?.innerText.trim() || '';
      const salaryPreview = node.querySelector('[data-qa="vacancy-serp__vacancy-compensation"]')?.innerText.trim() || '';
      const match = url.match(/vacancy\/(\d+)/);
      const vacancyId = match ? match[1] : null;

      return { vacancyId, url, title, company, location, salaryPreview };
    }).filter(Boolean)
  );

  console.log(`✅ Found ${vacancies.length} vacancies`);
  
  await page.close();
  return vacancies;
}

module.exports = { 
  scrapeVacancy, 
  applyToVacancy, 
  scrapeVacancyList,
  extractVacancyId
};