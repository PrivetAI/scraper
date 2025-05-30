const puppeteerExtra = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
const { getBrowser } = require("./helpers");

puppeteerExtra.use(Stealth());

const pages = new Map();

async function safeGoto(page, url, opts) {
  for (let i = 0; i < 3; i++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      if (e.message.includes("ERR_NETWORK_CHANGED") && i < 2) {
        await page.waitForTimeout(1000 * (i + 1));
        continue;
      }
      throw e;
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
  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(0);
  
  await safeGoto(page, url, { waitUntil: "domcontentloaded", timeout: 0 });
  
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
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  await safeGoto(page, url, { waitUntil: "domcontentloaded", timeout: 0 });
  
  await page.evaluate(async () => {
    const distance = 100;
    const delay = 100;
    while (document.scrollingElement.scrollTop + window.innerHeight < document.scrollingElement.scrollHeight) {
      document.scrollingElement.scrollBy(0, distance);
      await new Promise(r => setTimeout(r, delay));
    }
  });

  await page.waitForSelector('[data-qa^="vacancy-serp__vacancy"]', { timeout: 30000 });

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

  await page.close();
  return vacancies;
}

module.exports = { 
  scrapeVacancy, 
  applyToVacancy, 
  scrapeVacancyList,
  extractVacancyId
};