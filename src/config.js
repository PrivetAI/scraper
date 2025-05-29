const fs = require('fs');
const path = require('path');

let cookiesObject = {};
const cookiesPath = path.resolve(__dirname, '../cookies.json');

if (fs.existsSync(cookiesPath)) {
  const data = fs.readFileSync(cookiesPath, 'utf8');
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      // Если cookies в виде массива объектов [{name, value, domain, path}, ...]
      parsed.forEach(({ name, value }) => {
        cookiesObject[name] = value;
      });
    } else if (typeof parsed === 'object') {
      // Если cookies в виде { name: value, ... }
      cookiesObject = parsed;
    }
  } catch (e) {
    console.error('❌ Ошибка чтения cookies.json:', e);
  }
} else {
  console.warn('⚠️ cookies.json не найден в корне проекта.');
}

module.exports = {
  chromePath: '/usr/bin/google-chrome', // Укажи путь к Chrome
  viewport: { width: 1280, height: 800 },
  cookiesObject,
};
