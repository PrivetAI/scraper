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
      filename: path.join(__dirname, 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(__dirname, 'logs', 'combined.log'),
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
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    originalSend.call(this, data);
  };
  
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  next();
});

app.get('/vacancy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    logger.warn('Missing URL parameter', { endpoint: '/vacancy' });
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
      error: err.message, 
      stack: err.stack 
    });
    res.status(500).json({ error: err.message });
  }
});

app.post('/apply', async (req, res) => {
  const { vacancyId, coverLetterText } = req.body;
  if (!vacancyId || !coverLetterText) {
    logger.warn('Missing required parameters', { 
      endpoint: '/apply',
      hasVacancyId: !!vacancyId,
      hasCoverLetter: !!coverLetterText
    });
    return res.status(400).json({ error: 'Missing "vacancyId" or "coverLetterText"' });
  }

  try {
    logger.info('Applying to vacancy', { 
      vacancyId, 
      coverLetterLength: coverLetterText.length 
    });
    const result = await applyToVacancy(vacancyId, coverLetterText);
    logger.info('Application completed', { 
      vacancyId, 
      success: result.success 
    });
    res.json(result);
  } catch (err) {
    logger.error('Application failed', { 
      vacancyId, 
      error: err.message, 
      stack: err.stack 
    });
    res.status(500).json({ error: err.message });
  }
});

app.get('/list', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    logger.warn('Missing URL parameter', { endpoint: '/list' });
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
      error: err.message, 
      stack: err.stack 
    });
    res.status(500).json({ error: err.message });
  }
});

app.post('/batch-details', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    logger.warn('Invalid URLs parameter', { 
      endpoint: '/batch-details',
      type: typeof urls
    });
    return res.status(400).json({ error: 'Expected "urls" array' });
  }

  logger.info('Starting batch details scraping', { urlCount: urls.length });
  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      const vacancy = await scrapeVacancy(url);
      results.push(vacancy);
      logger.debug('Batch item scraped', { url, title: vacancy.title });
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
  logger.info('Health check requested');
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    endpoints: ['/vacancy', '/apply', '/list', '/batch-details']
  });
});

app.get('/logs', (req, res) => {
  const fs = require('fs');
  try {
    const logPath = path.join(__dirname, 'logs', 'combined.log');
    const logs = fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .slice(-100)
      .map(line => JSON.parse(line));
    res.json({ logs });
  } catch (err) {
    logger.error('Failed to read logs', { error: err.message });
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
  console.log(`🚀 HH Scraper API running on port ${PORT}`);
});