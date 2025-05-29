#!/usr/bin/env sh
set -e

# Создаём директорию под базу, если нет
mkdir -p /data

# Если файла базы ещё нет — создаём таблицу с нужной структурой
if [ ! -f /data/applied.db ]; then   
  if command -v sqlite3 >/dev/null 2>&1; then
# todo: структура бд
    sqlite3 /data/applied.db "CREATE TABLE IF NOT EXISTS applied (
      vacancyId TEXT PRIMARY KEY,
      url       TEXT NOT NULL,
      title     TEXT NOT NULL,
      appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    );"
  else
    touch /data/applied.db
  fi
fi
# Даем права пользователю node:node и право записи
chown -R node:node /data
chmod 700 /data
chmod 660 /data/applied.db

# Запускаем основную команду контейнера
exec "$@"
