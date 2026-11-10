# Кнопки для сайта семинара

Под каждым анонсом на www.cv.imm.uran.ru появляются кнопки:

| Кнопка | Что делает | Нужен сервер |
|---|---|---|
| 📅 В календарь (.ics) | скачивает событие (Outlook, Apple, Яндекс, Google) | нет |
| Google Календарь | открывает форму добавления события | нет |
| 🖼 Заставка | открывает `zastavka.html` с заполненными полями, PDF печатается кнопкой «Сохранить в PDF» | нет |
| ✈ Поделиться в Telegram | `t.me/share` с текстом анонса | нет |
| 📣 Опубликовать в канал | запускает workflow `parse_seminars.yml`, бот публикует анонс | GitHub Actions |

Кнопка «Опубликовать в канал» видна только на домене редактора (`*.edit.lineactworld.ru`).

## Подписка на календари

Над анонсами на странице `/seminar` есть блок «Календари сектора» с кнопками «+ Google Календарь», «Apple / Outlook» (`webcal://`), «Скопировать iCal-ссылку» (для Яндекс Календаря) и «Открыть». Идентификаторы календарей задаются в `CFG.calendars` в `site-tools.js`.

Календари ведёт аккаунт сектора `cvsectorimm@gmail.com`. Бот пишет в календарь семинаров через сервисный аккаунт: секреты `GOOGLE_SERVICE_ACCOUNT_JSON` и `SEMINARS_CALENDAR_ID`. Все анонсы со страницы переносятся в календарь запуском workflow с флажком `sync_calendar`, в Telegram при этом ничего не публикуется.

## Форма анонса в редакторе

При добавлении или правке мероприятия в разделе «Семинар» над стандартной формой LineAct появляются поля **Докладчик**, **Тема**, **Онлайн (ссылка)** и **Очно (место)**. Из них собираются обычные поля LineAct (сервер других не знает):

- «Название мероприятия» = `Докладчик — Тема`;
- «Место» = `Онлайн: ссылка` и `Офлайн: место`, каждое на своей строке.

Поля LineAct блокируются, чтобы их не правили в обход. Ссылка «править поля LineAct вручную» снимает блокировку.

Старые анонсы при открытии на правку разбираются в новые поля, но перезаписываются в новом формате, только если эти поля изменить. Парсеры (`site-tools.js` и `seminar_bot.py`) понимают и старый, и новый формат. Если правка поменяла заголовок уже опубликованного анонса, бот всё равно считает его опубликованным.

## Файлы

- `site-tools.js` — скрипт для сайта (чистый JS, `$` от Prototype.js не трогает).
- `zastavka.html` — генератор заставки; принимает параметры `?title=&speaker=&affil=&date=YYYY-MM-DD&time=HH:MM&link=&room=&platform=&tg=&qr=`.

## Установка

1. Содержимое папки `web/` публикуется на GitHub Pages из публичного репозитория [IMM-cv-sector/cv-seminar-web](https://github.com/IMM-cv-sector/cv-seminar-web), потому что `calendar-bot` приватный, а Pages для приватных репозиториев требуют платного тарифа. Настройка: Settings → Pages → Deploy from a branch → `main` / root. После правок здесь скопируйте файлы туда.
2. В админке сайта: «Настройка сайта → Счётчики посетителей», в конец поля «Код счётчиков» добавить:
   ```html
   <script src="https://imm-cv-sector.github.io/cv-seminar-web/site-tools.js"></script>
   ```
   Генератор заставки ищется рядом со скриптом. Остальное можно переопределить:
   ```html
   <script>window.CVS_CONFIG = { repo: 'IMM-cv-sector/calendar-bot', branch: 'master', tgChannel: 'cv_seminar' }</script>
   ```
3. Публикация из браузера. Нужен fine-grained токен GitHub (Settings → Developer settings → Fine-grained tokens):
   - Repository access: только `IMM-cv-sector/calendar-bot`.
   - Permissions: **Actions: Read and write**, остальное не нужно.

   При первом нажатии «Опубликовать в канал» скрипт попросит токен и сохранит его в localStorage этого браузера. В код сайта токен не попадает.

   Без токена анонс можно опубликовать вручную: Actions → *Parse and publish seminars* → Run workflow → вставить ссылку на анонс.

## Секреты репозитория `calendar-bot`

Settings → Secrets and variables → Actions:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` (например, `@cv_seminar`).
- Необязательно: `GOOGLE_SERVICE_ACCOUNT_JSON`, `SEMINARS_CALENDAR_ID`. Если они заданы, бот после публикации заводит событие в Google Calendar.
