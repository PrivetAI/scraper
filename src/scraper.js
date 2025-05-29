// src/scraper.js
const puppeteerExtra = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");
const { URL } = require("url");


puppeteerExtra.use(Stealth());

let browser;
const pages = new Map(); // vacancyId -> Puppeteer Page

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const host = process.env.PUPPETEER_DEBUG_HOST || "localhost";
  const port = process.env.PUPPETEER_DEBUG_PORT || 9222;
  const versionUrl = `http://${host}:${port}/json/version`;
  console.log("🌐 Fetching DevTools endpoint from", versionUrl);
  const { data } = await axios.get(versionUrl, { timeout: 15000 });
  const wsEndpoint = data.webSocketDebuggerUrl;
  browser = await puppeteerExtra.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: null,
  });
  console.log("✅ Puppeteer connected to", wsEndpoint);
  return browser;
}

async function safeGoto(page, url, opts) {
  for (let i = 0; i < 3; i++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      if (e.message.includes("ERR_NETWORK_CHANGED") && i < 2) {
        console.warn(`⚠️ network error, retry ${i + 1}/3`);
        await page.waitForTimeout(1000 * (i + 1));
        continue;
      }
      throw e;
    }
  }
}
async function getVacancyDescription(page) {
  // 1. Попытка раскрыть описание, если есть кнопка «Показать полностью»
  const expandButtonSelector =
    '[data-qa="vacancy-description-toggle-button"], [data-qa="vacancy-description-toggle"]';
  const expandBtn = await page.$(expandButtonSelector);
  if (expandBtn) {
    try {
      await expandBtn.click();
      await page.waitForTimeout(500);
    } catch (err) {
      console.warn("Не удалось развернуть описание:", err);
    }
  }

  // 2. Основные селекторы блока описания
  const selectors = [
    '[data-qa="vacancy-description"]',
    "#vacancy-description__text",
    ".vacancy-description",
    ".g-user-content",
  ];

  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2000 });
      // Собираем все <p> и <li> внутри контейнера
      const content = await page.$eval(sel, (container) => {
        const nodes = Array.from(container.querySelectorAll("p, li"));
        const texts = nodes
          .map((node) => node.innerText.trim())
          .filter(Boolean);
        if (texts.length) {
          // разделяем абзацы пустой строкой
          return texts.join("\n\n");
        }
        // если не нашли ни одного <p> или <li>, берём весь текст
        return container.innerText.trim();
      });

      if (content) {
        console.log(`→ Found description by ${sel}`);
        return content;
      }
    } catch {
      // селектор не найден — переходим к следующему
    }
  }

  // 3. Крайний случай — весь текст страницы
  console.warn("⚠️ Falling back to full page text");
  return (await page.evaluate(() => document.body.innerText)).trim();
}

async function applyOnPage(page, coverLetterText) {
  // 0) Проверка, был ли уже отклик
  const alreadyResponded = await page.$x(
    "//div[contains(., 'Вы откликнулись')]"
  );
  if (alreadyResponded.length > 0) {
    console.warn("⚠️ Already responded — skipping application");
    return { success: false, skipped: true };
  }

  console.log('→ Clicking initial "Откликнуться"');
  const [initBtn] = await page.$x("//span[contains(text(),'Откликнуться')]");
  if (!initBtn) throw new Error("Initial respond button not found");

  // 1) Проверка редиректа после первого клика
  let redirected = false;
  await Promise.all([
    initBtn.click(),
    page
      .waitForNavigation({ timeout: 3000 })
      .then(() => {
        redirected = true;
      })
      .catch(() => {
        /* редиректа не было */
      }),
  ]);

  if (redirected) {
    console.warn("⚠️ Redirect detected after initial click — aborting");
    return { success: false };
  }

  await page.waitForTimeout(500);

  // 2) Подтверждение предупреждения о релокации (и проверка редиректа)
  const relocationSel = '[data-qa="relocation-warning-confirm"]';
  if (await page.$(relocationSel)) {
    console.log("→ Confirming relocation warning");

    redirected = false;
    await Promise.all([
      page.click(relocationSel),
      page
        .waitForNavigation({ timeout: 1000 })
        .then(() => {
          redirected = true;
        })
        .catch(() => {
          /* редиректа не было */
        }),
    ]);

    if (redirected) {
      console.warn(
        "⚠️ Redirect detected after relocation confirmation — aborting"
      );
      return { success: false };
    }

    await page.waitForTimeout(500);
  }

  console.log("→ Waiting for response modal");
  await page.waitForSelector('form[name="vacancy_response"]', {
    visible: true,
    timeout: 1000,
  });
  await page.waitForTimeout(300)

  // 3) Опционально кликаем "Добавить сопроводительное"
  const addBtnSel = 'button[data-qa="add-cover-letter"]';
  const addCoverLetterBtn = await page
    .waitForSelector(addBtnSel, { visible: true, timeout: 1000 })
    .catch(() => null);
  if (addCoverLetterBtn) {
    console.log('→ Scrolling to and clicking "Добавить сопроводительное"');
    await addCoverLetterBtn.evaluate((el) =>
      el.scrollIntoView({ block: "center" })
    );
    await page.waitForTimeout(200);
    try {
      await addCoverLetterBtn.click({ delay: 50 });
    } catch {
      await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn)
          btn.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
          );
      }, addBtnSel);
    }
    await page.waitForTimeout(500);
  } else {
    console.log('→ No "Добавить сопроводительное" button found — skipping');
  }

  // 4) Заполняем сопроводительное
  console.log("→ Filling cover letter with human-like typing");
  const textareaSel =
    'textarea[data-qa="vacancy-response-popup-form-letter-input"]';

  // ждём и фокусируемся
  await page.waitForSelector(textareaSel, { visible: true, timeout: 2000 });
  await page.focus(textareaSel);

  // надёжно очищаем:
  await page.waitForTimeout(randomIntFromInterval(100, 300));
  //  - Ctrl+A (выделить всё) + Backspace
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  // небольшая задержка перед вводом
  await page.waitForTimeout(randomIntFromInterval(100, 300));

  for (const char of coverLetterText) {
    await page.type(textareaSel, char, { delay: randomIntFromInterval(5, 15) });
  }

  // небольшая пауза после ввода, чтобы страница “успокоилась”
  await page.waitForTimeout(randomIntFromInterval(200, 500));

  // 5) Отправляем форму
  console.log("→ Clicking submit button in modal");
  const submitSel = 'button[data-qa="vacancy-response-submit-popup"]';
  await page.waitForSelector(`${submitSel}:not([disabled])`, {
    visible: true,
    timeout: 2000,
  });
  await page.click(submitSel);

  console.log("✅ Application submitted successfully");
  return { success: true };
}

async function scrapeVacancy(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(0);
  console.log("→ Opening", url);
  await safeGoto(page, url, { waitUntil: "domcontentloaded", timeout: 0 });
  console.log("ready to scrape");
  const description = await getVacancyDescription(page);
  const vacancyId = new URL(url).pathname.split("/").filter(Boolean).pop();
  pages.set(vacancyId, page);
  console.log(`🆔 Saved page for vacancyId: ${vacancyId}`);
  return { vacancyId, description };
}

async function applyToVacancy(vacancyId, coverLetterText) {
  const page = pages.get(vacancyId);
  if (!page) throw new Error(`Session for ${vacancyId} not found`);
  const result = await applyOnPage(page, coverLetterText);
  await page.close();
  pages.delete(vacancyId);
  console.log(`🗑️ Closed page for vacancyId: ${vacancyId}`);
  return result;
}

/**
 * Прокручивает страницу до низа, чтобы подгрузить ленивые элементы.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    const distance = 100;
    const delay = 100;
    while (
      document.scrollingElement.scrollTop + window.innerHeight <
      document.scrollingElement.scrollHeight
    ) {
      document.scrollingElement.scrollBy(0, distance);
      await new Promise((r) => setTimeout(r, delay));
    }
  });
}

/**
 * Забирает список до 50 вакансий с hh.ru (включая премиум‑карточки).
 */
async function scrapeVacancyList(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await safeGoto(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 0,
  });

  // 6) Скроллим вниз, чтобы сработал lazy‑load
  await autoScroll(page);

  // 7) Ждём, пока появятся все карточки (включая premium)
  await page.waitForSelector('[data-qa^="vacancy-serp__vacancy"]', {
    timeout: 30000,
  });

  // 8) Сбор данных
  const vacancies = await page.$$eval(
    '[data-qa^="vacancy-serp__vacancy"]',
    (nodes) =>
      nodes
        .map((node) => {
          const link = node.querySelector('a[data-qa="serp-item__title"]');
          if (!link) return null;

          const url = link.href;
          const title =
            link
              .querySelector('[data-qa="serp-item__title-text"]')
              ?.innerText.trim() || "";
          const match = url.match(/vacancy\/(\d+)/);
          const vacancyId = match ? match[1] : null;

          return { vacancyId, url, title };
        })
        .filter(Boolean)
  );

  await page.close();
  return vacancies;
}

function randomIntFromInterval(min, max) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

module.exports = { scrapeVacancy, applyToVacancy, scrapeVacancyList };
