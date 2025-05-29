// src/server.js
const express = require('express');
const { scrapeVacancy, applyToVacancy, scrapeVacancyList } = require('./scraper');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.path}`);
  next();
});

// 1) Получаем описание вакансии и возвращаем vacancyId
app.get('/get_vacancy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const { vacancyId, description } = await scrapeVacancy(url);
    res.json({ vacancyId, description });
  } catch (err) {
    console.error('❌ /get_vacancy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Отправляем отклик, используя vacancyId
app.post('/apply_to_vacancy', async (req, res) => {
  if (!req.body.vacancyId || !req.body.coverLetterText) {
    return res
      .status(400)
      .json({ error: 'Missing "vacancyId" or "coverLetterText" in request body' });
  }
  try {
    const { vacancyId, coverLetterText } = req.body;
    console.log(`➡️ Applying to vacancy ${vacancyId} with cover letter text of length ${coverLetterText.length}`);
    const result = await applyToVacancy(vacancyId, coverLetterText);
    res.json(result);
  } catch (err) {
    console.error('❌ /apply_to_vacancy error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/list_vacancies', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing "url" query parameter' });
  try {
    const list = await scrapeVacancyList(url);
    res.json({ vacancies: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/test", async (req, res) => {
  try {
    res.send("success");
  } catch (err) {
    console.error("❌ /test error:", err);
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scraper API listening on http://localhost:${PORT}`);
});
