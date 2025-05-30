const express = require('express');
const winston = require('winston');
const path = require('path');
const { scrapeVacancy, applyToVacancy, scrapeVacancyList } = require('./scraper');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'hh-scraper' },
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs', 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs', 'combined.log'),
      maxsize: 5242880,
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration
    });
    originalSend.call(this, data);
  };
  
  logger.info('Request started', {
    method: req.method,
    url: req.url
  });
  
  next();
});

app.get('/vacancy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" parameter' });
  }

  try {
    logger.info('Scraping vacancy', { url });
    const vacancy = await scrapeVacancy(url);
    logger.info('Vacancy scraped successfully', { 
      url, 
      title: vacancy.title,
      company: vacancy.company 
    });
    res.json(vacancy);
  } catch (err) {
    logger.error('Vacancy scraping failed', { 
      url, 
      error: err.message
    });
    res.status(500).json({ error: err.message });
  }
});

app.post('/apply', async (req, res) => {
  const { vacancyId, coverLetterText } = req.body;
  if (!vacancyId || !coverLetterText) {
    return res.status(400).json({ error: 'Missing "vacancyId" or "coverLetterText"' });
  }

  try {
    logger.info('Applying to vacancy', { vacancyId });
    const result = await applyToVacancy(vacancyId, coverLetterText);
    logger.info('Application completed', { 
      vacancyId, 
      success: result.success 
    });
    res.json(result);
  } catch (err) {
    logger.error('Application failed', { 
      vacancyId, 
      error: err.message
    });
    res.status(500).json({ error: err.message });
  }
});

app.get('/list', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" parameter' });
  }

  try {
    logger.info('Scraping vacancy list', { url });
    const vacancies = await scrapeVacancyList(url);
    logger.info('Vacancy list scraped', { 
      url, 
      count: vacancies.length 
    });
    res.json({ count: vacancies.length, vacancies });
  } catch (err) {
    logger.error('Vacancy list scraping failed', { 
      url, 
      error: err.message
    });
    res.status(500).json({ error: err.message });
  }
});

app.post('/batch-details', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'Expected "urls" array' });
  }

  logger.info('Starting batch details scraping', { urlCount: urls.length });
  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      const vacancy = await scrapeVacancy(url);
      results.push(vacancy);
    } catch (err) {
      errors.push({ url, error: err.message });
      logger.warn('Batch item failed', { url, error: err.message });
    }
  }

  logger.info('Batch scraping completed', {
    total: urls.length,
    success: results.length,
    failed: errors.length
  });

  res.json({ 
    success: results.length,
    failed: errors.length,
    results,
    errors
  });
});

app.get('/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    endpoints: ['/vacancy', '/apply', '/list', '/batch-details']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
  console.log(`🚀 HH Scraper API running on port ${PORT}`);
});