/*
 * Кнопки под анонсами семинара на сайте сектора (LineAct).
 *
 * Подключение: «Настройка сайта → Счётчики посетителей», в конец поля:
 *   <script src="https://<user>.github.io/<repo>/site-tools.js"></script>
 *
 * Под каждым анонсом (.la_element_event) появляются кнопки:
 *   .ics · Google Календарь · Заставка · Поделиться в Telegram
 * а на домене редактора (*.edit.lineactworld.ru) ещё и «Опубликовать в канал»:
 * она запускает GitHub Actions workflow, который публикует анонс ботом.
 *
 * Настройки можно переопределить до подключения скрипта:
 *   <script>window.CVS_CONFIG = { repo: 'owner/repo' }</script>
 *
 * Код на чистом JS: на сайте Prototype.js и jQuery.noConflict, $ не трогаем.
 */
(function () {
    'use strict';

    var script = document.currentScript;
    var BASE = script && script.src ? script.src.replace(/[^/]*$/, '') : '';

    var CFG = Object.assign({
        publicOrigin: 'https://www.cv.imm.uran.ru',
        repo: 'IMM-cv-sector/calendar-bot',
        branch: 'master',
        workflow: 'parse_seminars.yml',
        tgChannel: 'cv_seminar',
        durationMin: 90,
        alarmMin: 30,
        tzOffset: 5,                       // Екатеринбург, UTC+5, без перехода на летнее время
        zastavkaUrl: BASE + 'zastavka.html',
        seminarSection: '462397',          // id раздела «Семинар» в LineAct
        speakerSep: ' — ',                 // «Докладчик — Тема» в заголовке анонса
        // Публичные Google-календари: блок «Подписаться» над анонсами на странице /seminar
        calendars: [
            { title: 'Семинары сектора', id: '64d45127c5e794caad7939f63914686be4dd3336b0eea6d3e19c400dbcbf3743@group.calendar.google.com' },
            { title: 'Конференции и события', id: 'c0434ee3a0296ac91909466bc62f96aa0e48c6e6cd3aafe649d1c55066339262@group.calendar.google.com' }
        ]
    }, window.CVS_CONFIG || {});

    var IS_EDITOR = /\.edit\./.test(location.hostname);
    var TOKEN_KEY = 'cvs.githubToken';

    var MONTHS = {
        'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
        'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12
    };

    function pad(n) { return String(n).padStart(2, '0'); }
    function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        } catch (e) { return null; }
    }

    // ---------- Разбор анонса ----------

    // «Стародубцев И.С. Тема», «П.А. Васев Тема», «С.С.Потоцкий Тема», «А. Пшеничников. Тема»
    var RE_INITIALS_FIRST = /^((?:[А-ЯЁA-Z]\.\s*){1,2}[А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁA-Z][а-яёa-z]+)?)\.?\s+(.+)$/;
    var RE_SURNAME_FIRST = /^([А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁA-Z][а-яёa-z]+)?\s+[А-ЯЁA-Z]\.\s*(?:[А-ЯЁA-Z]\.)?)\s*(.+)$/;

    function splitSpeaker(heading) {
        heading = clean(heading);
        // «Фамилия И.О. Тема», «И.О. Фамилия Тема» — и старые анонсы, и новые «… — Тема»
        var m = heading.match(RE_INITIALS_FIRST) || heading.match(RE_SURNAME_FIRST);
        if (m && !/^\s*(,|и\s)/.test(m[2])) return { speaker: clean(m[1]), topic: clean(m[2]).replace(/^[.:–—-]\s*/, '') };
        // Имя без инициалов: только по разделителю «Докладчик — Тема»
        var sep = CFG.speakerSep.trim(), i = heading.indexOf(' ' + sep + ' ');
        if (i > 0 && i <= 60) return { speaker: heading.slice(0, i), topic: clean(heading.slice(i + sep.length + 2)) };
        return { speaker: '', topic: heading };
    }

    // «Где»: «Онлайн: url / Офлайн: место» (новый формат) или свободный текст со ссылкой (старый)
    function splitWhere(text) {
        text = text || '';
        var urlMatch = text.match(/(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>"]*/i);
        var online = urlMatch ? urlMatch[0].replace(/[.,;)]+$/, '') : '';
        if (online && !/^https?:/i.test(online)) online = 'https://' + online;
        var place = clean(text.replace(urlMatch ? urlMatch[0] : /$^/, ' ')
            .replace(/(Онлайн|Офлайн|Очно|online|offline)\s*:/gi, ' ')
            .replace(/\s*[,;.]\s*$/, '').replace(/^\s*[,;]\s*/, ''));
        return { online: online, place: place };
    }

    function toPublicUrl(href) {
        try {
            var u = new URL(href, location.href);
            return CFG.publicOrigin + u.pathname;
        } catch (e) { return href; }
    }

    function parseEvent(el) {
        var titleEl = el.querySelector('.la_element_title .element_handle, .la_element_title');
        var content = el.querySelector('.la_element_content');
        if (!titleEl || !content) return null;

        var heading = clean(titleEl.textContent);
        var bold = [].filter.call(content.children, function (c) { return c.tagName === 'B'; })
            .map(function (b) { return b.innerText || b.textContent; });

        var m = clean(bold[0]).match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s+в\s+(\d{1,2})[:.](\d{2}))?/i);
        if (!m || !MONTHS[m[2].toLowerCase()]) return null;
        var y = +m[3], mo = MONTHS[m[2].toLowerCase()], d = +m[1];
        var h = m[4] ? +m[4] : 16, mi = m[5] ? +m[5] : 0;
        var start = new Date(Date.UTC(y, mo - 1, d, h - CFG.tzOffset, mi));

        var where = splitWhere(bold[1]);
        var online = where.online, place = where.place;

        var full = el.querySelector('[id$="_full_link"]');
        var share = content.querySelector('.addthis_toolbox[data-url]');
        var pageUrl = share ? share.getAttribute('data-url')
            : full ? toPublicUrl(full.getAttribute('href'))
            : toPublicUrl(location.pathname);

        var abstractEl = content.querySelector('[id^="announce_of_events"]');
        var abstract = abstractEl ? clean(abstractEl.textContent) : '';
        if (!abstract) {
            abstract = [].map.call(content.querySelectorAll('p'), function (p) { return clean(p.textContent); })
                .filter(Boolean).join('\n\n');
        }

        var sp = splitSpeaker(heading);
        return {
            id: el.id,
            heading: heading,
            speaker: sp.speaker,
            topic: sp.topic,
            dateIso: y + '-' + pad(mo) + '-' + pad(d),
            timeHm: pad(h) + ':' + pad(mi),
            start: start,
            end: new Date(start.getTime() + CFG.durationMin * 60000),
            place: place,
            online: online,
            abstract: abstract,
            url: pageUrl
        };
    }

    // ---------- Календарь ----------

    function icsDate(dt) { return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function icsEscape(t) {
        return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    }
    function icsFold(line) {
        var enc = new TextEncoder(), out = [], cur = '', bytes = 0;
        for (var ch of line) {
            var b = enc.encode(ch).length, limit = out.length ? 74 : 75;
            if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
            cur += ch; bytes += b;
        }
        out.push(cur);
        return out.join('\r\n ');
    }

    function description(ev) {
        var lines = ['Семинар сектора компьютерной визуализации ИММ УрО РАН', ''];
        lines.push(ev.heading, '');
        lines.push(ev.timeHm + ' ЕКБ (UTC+5)');
        if (ev.place) lines.push('Место: ' + ev.place);
        if (ev.online) lines.push('Подключение: ' + ev.online);
        lines.push('', 'Анонс: ' + ev.url);
        return lines.join('\n');
    }

    function location_(ev) { return ev.online || ev.place || 'ИММ УрО РАН, Екатеринбург'; }

    function buildIcs(ev) {
        var uid = ev.id.replace(/\D/g, '') + '@cv.imm.uran.ru';
        var rows = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IMM UB RAS//CV Seminar//RU',
            'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
            'UID:' + uid,
            'DTSTAMP:' + icsDate(new Date()),
            'DTSTART:' + icsDate(ev.start),
            'DTEND:' + icsDate(ev.end),
            'SUMMARY:' + icsEscape('Семинар сектора КВ: ' + ev.heading),
            'DESCRIPTION:' + icsEscape(description(ev)),
            'LOCATION:' + icsEscape(location_(ev)),
            'URL:' + ev.url
        ];
        if (CFG.alarmMin > 0) rows.push('BEGIN:VALARM', 'ACTION:DISPLAY',
            'DESCRIPTION:' + icsEscape(ev.heading), 'TRIGGER:-PT' + CFG.alarmMin + 'M', 'END:VALARM');
        rows.push('END:VEVENT', 'END:VCALENDAR');
        return rows.map(icsFold).join('\r\n') + '\r\n';
    }

    function downloadIcs(ev) {
        var blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'seminar-' + ev.dateIso + '.ics';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    function googleLink(ev) {
        return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
            action: 'TEMPLATE',
            text: 'Семинар сектора КВ: ' + ev.heading,
            dates: icsDate(ev.start) + '/' + icsDate(ev.end),
            details: description(ev),
            location: location_(ev),
            ctz: 'Asia/Yekaterinburg'
        });
    }

    // ---------- Заставка и Telegram ----------

    function zastavkaLink(ev) {
        return CFG.zastavkaUrl + '?' + new URLSearchParams({
            title: ev.topic,
            speaker: ev.speaker,
            date: ev.dateIso,
            time: ev.timeHm,
            link: ev.online,
            room: '',
            tg: 'https://t.me/' + CFG.tgChannel
        });
    }

    function tgShareLink(ev) {
        var text = ev.heading + '\n' + ev.start.toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg'
        }) + ' (ЕКБ)' + (ev.online ? '\n' + ev.online : '');
        return 'https://t.me/share/url?' + new URLSearchParams({ url: ev.url, text: text });
    }

    // ---------- Публикация через GitHub Actions ----------

    function actionsPage() {
        return 'https://github.com/' + CFG.repo + '/actions/workflows/' + CFG.workflow;
    }

    function dispatch(ev, token) {
        return fetch('https://api.github.com/repos/' + CFG.repo + '/actions/workflows/' + CFG.workflow + '/dispatches', {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': 'Bearer ' + token,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ ref: CFG.branch, inputs: { event_url: ev.url, force: 'false' } })
        }).then(function (r) {
            if (r.status === 204) return;
            return r.text().then(function (t) { throw new Error(r.status + ' ' + t.slice(0, 200)); });
        });
    }

    function publishControl(ev, box) {
        var wrap = el('span', 'cvs-publish');
        var btn = button('📣 Опубликовать в канал', 'cvs-btn cvs-btn-accent');
        var status = el('span', 'cvs-status');
        wrap.append(btn, status);

        var armed = false, timer;
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var token = store(TOKEN_KEY);
            if (!token) { tokenForm(box, function () { btn.click(); }); return; }
            if (!armed) {
                armed = true;
                btn.textContent = 'Точно опубликовать?';
                timer = setTimeout(function () { armed = false; btn.textContent = '📣 Опубликовать в канал'; }, 4000);
                return;
            }
            clearTimeout(timer);
            armed = false;
            btn.disabled = true;
            btn.textContent = '📣 Отправляю…';
            dispatch(ev, token).then(function () {
                btn.textContent = '📣 Запущено ✓';
                status.innerHTML = '';
                status.append('Бот опубликует анонс примерно через минуту. ', link('Ход выполнения', actionsPage()));
            }).catch(function (err) {
                btn.disabled = false;
                btn.textContent = '📣 Опубликовать в канал';
                status.textContent = 'Ошибка: ' + err.message + ' ';
                if (/^(401|403|404)/.test(err.message)) {
                    status.append(button('Сменить токен', 'cvs-link', function () { store(TOKEN_KEY, null); tokenForm(box); }));
                }
            });
        });
        return wrap;
    }

    function tokenForm(box, onSaved) {
        if (box.querySelector('.cvs-token')) return;
        var f = el('div', 'cvs-token');
        var input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'github_pat_…';
        input.autocomplete = 'off';
        var save = button('Сохранить', 'cvs-btn', function () {
            var v = input.value.trim();
            if (!v) return;
            store(TOKEN_KEY, v);
            f.remove();
            if (onSaved) onSaved();
        });
        var cancel = button('Отмена', 'cvs-link', function () { f.remove(); });
        var hint = el('div', 'cvs-hint');
        hint.append('Нужен fine-grained токен GitHub с доступом только к репозиторию ' + CFG.repo +
            ' и правом Actions: Read and write. Он хранится только в этом браузере. Без токена можно запустить публикацию вручную: ',
            link('страница workflow', actionsPage()), ' → Run workflow → вставить ссылку на анонс.');
        f.append(input, save, cancel, hint);
        box.append(f);
        input.focus();
    }

    // ---------- Вёрстка ----------

    function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function link(text, href, cls) {
        var a = el('a', cls); a.textContent = text; a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a;
    }
    function button(text, cls, onClick) {
        var b = el('button', cls); b.type = 'button'; b.textContent = text;
        if (onClick) b.addEventListener('click', function (e) { e.preventDefault(); onClick(e); });
        return b;
    }

    function injectStyles() {
        if (document.getElementById('cvs-style')) return;
        var s = el('style');
        s.id = 'cvs-style';
        s.textContent = [
            '.cvs-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 4px;font-size:13px;line-height:1.3}',
            '.cvs-tools .cvs-btn,.cvs-subscribe .cvs-btn{display:inline-block;padding:4px 10px;border:1px solid rgba(0,0,0,.25);border-radius:4px;',
            'background:rgba(255,255,255,.65);color:#222;text-decoration:none;font:inherit;cursor:pointer;white-space:nowrap}',
            '.cvs-tools .cvs-btn:hover,.cvs-subscribe .cvs-btn:hover{background:#fff;border-color:rgba(0,0,0,.45)}',
            '.cvs-tools .cvs-btn-accent{border-color:#2a7ab0;color:#1d5f8c}',
            '.cvs-tools .cvs-btn[disabled]{opacity:.6;cursor:default}',
            '.cvs-tools .cvs-link{background:none;border:0;padding:0;color:#1d5f8c;text-decoration:underline;cursor:pointer;font:inherit}',
            '.cvs-publish{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}',
            '.cvs-status{font-size:12px;color:#444}',
            '.cvs-token{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px}',
            '.cvs-token input{flex:1 1 220px;padding:4px 8px;border:1px solid rgba(0,0,0,.3);border-radius:4px;font:inherit}',
            '.cvs-hint{flex-basis:100%;font-size:12px;color:#444}',
            '.cvs-form{display:flex;flex-wrap:wrap;gap:8px 12px;margin:0 0 14px;padding:10px 12px;border:1px solid #2a7ab0;',
            'border-radius:6px;background:rgba(255,255,255,.7);font-size:14px}',
            '.cvs-form-head{flex-basis:100%;font-weight:bold}',
            '.cvs-form .cvs-link{font-weight:normal;font-size:12px;background:none;border:0;padding:0;color:#1d5f8c;text-decoration:underline;cursor:pointer}',
            '.cvs-field{display:flex;flex-direction:column;gap:2px;flex:1 1 200px;min-width:0}',
            '.cvs-field.cvs-wide{flex:1 1 100%}',
            '.cvs-field span{font-size:12px;color:#444}',
            '.cvs-field input{width:100%;box-sizing:border-box;padding:4px 8px;font:inherit}',
            '.cvs-form.cvs-off .cvs-field,.cvs-form.cvs-off .cvs-hint{display:none}',
            '.cvs-locked{background:#eee!important;color:#555}',
            '.cvs-subscribe{margin:0 0 16px;padding:10px 12px;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:rgba(255,255,255,.55);font-size:14px}',
            '.cvs-cal-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0;font-size:13px}',
            '.cvs-cal-name{min-width:160px;font-weight:bold;font-size:13px}'
        ].join('');
        document.head.appendChild(s);
    }

    function render(ev, host) {
        var box = el('div', 'cvs-tools');
        box.append(
            button('📅 В календарь (.ics)', 'cvs-btn', function () { downloadIcs(ev); }),
            link('Google Календарь', googleLink(ev), 'cvs-btn'),
            link('🖼 Заставка', zastavkaLink(ev), 'cvs-btn'),
            link('✈ Поделиться в Telegram', tgShareLink(ev), 'cvs-btn')
        );
        if (IS_EDITOR) box.append(publishControl(ev, box));
        host.after(box);
    }

    // ---------- Подписка на календари ----------

    function calendarLinks(id) {
        var ical = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(id) + '/public/basic.ics';
        return {
            google: 'https://calendar.google.com/calendar/u/0?cid=' + btoa(id).replace(/=+$/, ''),
            web: 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(id) + '&ctz=Asia%2FYekaterinburg',
            ical: ical,
            webcal: ical.replace(/^https:/, 'webcal:')
        };
    }

    function copyButton(text) {
        var b = button('Скопировать iCal-ссылку', 'cvs-btn', function () {
            var done = function () { b.textContent = 'Скопировано ✓'; setTimeout(function () { b.textContent = 'Скопировать iCal-ссылку'; }, 2000); };
            if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
            else fallback();
            function fallback() {
                var t = document.createElement('textarea');
                t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
                document.body.appendChild(t); t.select();
                try { document.execCommand('copy'); done(); } catch (e) { b.textContent = 'Не удалось скопировать'; }
                t.remove();
            }
        });
        b.title = text;
        return b;
    }

    function renderSubscribe() {
        var list = document.getElementById('elements_block');
        if (!list || !/^\/seminar\/?$/.test(location.pathname) || document.querySelector('.cvs-subscribe')) return;
        var cals = (CFG.calendars || []).filter(function (c) { return c && c.id; });
        if (!cals.length) return;
        var box = el('div', 'cvs-subscribe');
        var head = el('div', 'cvs-form-head');
        head.textContent = '📅 Календари сектора';
        box.append(head);
        cals.forEach(function (c) {
            var l = calendarLinks(c.id);
            var row = el('div', 'cvs-cal-row');
            var name = el('span', 'cvs-cal-name'); name.textContent = c.title;
            row.append(name,
                link('+ Google Календарь', l.google, 'cvs-btn'),
                link('Apple / Outlook', l.webcal, 'cvs-btn'),
                copyButton(l.ical),
                link('Открыть', l.web, 'cvs-btn'));
            box.append(row);
        });
        var hint = el('div', 'cvs-hint');
        hint.textContent = 'Подписка обновляется сама: новые семинары появятся в вашем календаре. ' +
            'Для Яндекс Календаря: «Новый календарь → Подписаться» и вставить iCal-ссылку.';
        box.append(hint);
        list.parentNode.insertBefore(box, list);
    }

    // ---------- Форма добавления / редактирования анонса ----------
    // Поля LineAct остаются как есть (сервер их не знает иначе), а над ними появляются
    // отдельные поля. Из них собираются:
    //   element[title]    = «Докладчик — Тема»
    //   data[event_place] = «Онлайн: ссылка» + «Офлайн: место» (каждое на своей строке)

    function isSeminarForm(form) {
        if (!form.querySelector('#data_event_place') || !form.querySelector('#element_title')) return false;
        var section = form.querySelector('input[name="section"]');
        if (section) return section.value === CFG.seminarSection;
        return /^\/(seminar|e\/)/.test(location.pathname);   // форма редактирования раздел не передаёт
    }

    function composeTitle(speaker, topic) {
        speaker = clean(speaker); topic = clean(topic);
        return speaker && topic ? speaker + CFG.speakerSep + topic : speaker || topic;
    }

    function composeWhere(online, place) {
        online = clean(online); place = clean(place);
        if (online && !/^[a-z][a-z0-9+.-]*:/i.test(online)) online = 'https://' + online;
        var lines = [];
        if (online) lines.push('Онлайн: ' + online);
        if (place) lines.push('Офлайн: ' + place);
        return lines.join('\n');
    }

    function enhanceForm(form) {
        if (form.dataset.cvsEnhanced) return;
        form.dataset.cvsEnhanced = '1';

        var title = form.querySelector('#element_title');
        var where = form.querySelector('#data_event_place');
        var sp = splitSpeaker(title.value);
        var wh = splitWhere(where.value);

        var panel = el('div', 'cvs-form');
        var head = el('div', 'cvs-form-head');
        head.textContent = 'Анонс семинара';
        var manual = button('править поля LineAct вручную', 'cvs-link');
        head.append(' · ', manual);

        function field(label, value, placeholder, wide) {
            var wrap = el('label', 'cvs-field' + (wide ? ' cvs-wide' : ''));
            var cap = el('span'); cap.textContent = label;
            var inp = document.createElement('input');
            inp.type = 'text'; inp.value = value; inp.placeholder = placeholder;
            wrap.append(cap, inp);
            panel.append(wrap);
            return inp;
        }

        panel.append(head);
        var fSpeaker = field('Докладчик', sp.speaker, 'И.С. Иванов');
        var fTopic = field('Тема доклада', sp.topic, 'Название доклада', true);
        var fOnline = field('Онлайн (ссылка)', wh.online, 'https://videoconf.uran.ru/…', true);
        var fPlace = field('Очно (место)', wh.place, 'ИММ УрО РАН, а211 — пусто, если только онлайн', true);
        var preview = el('div', 'cvs-hint');
        panel.append(preview);

        var synced = true, touched = false;
        function sync() {
            if (!synced) return;
            touched = true;
            title.value = composeTitle(fSpeaker.value, fTopic.value);
            where.value = composeWhere(fOnline.value, fPlace.value);
            preview.textContent = 'На сайте: «' + (title.value || '—') + '»; Где: ' +
                (where.value.replace(/\n/g, ' · ') || '—');
        }
        [fSpeaker, fTopic, fOnline, fPlace].forEach(function (i) { i.addEventListener('input', sync); });

        function lockNative(lock) {
            [title, where].forEach(function (n) {
                n.readOnly = lock;
                n.classList.toggle('cvs-locked', lock);
                n.title = lock ? 'Заполняется из полей «Анонс семинара» выше' : '';
            });
        }
        manual.addEventListener('click', function () {
            synced = false;
            lockNative(false);
            panel.classList.add('cvs-off');
            head.textContent = 'Анонс семинара: поля LineAct редактируются вручную';
        });

        // Старый анонс переписываем в новом формате, только если поля действительно меняли:
        // иначе после правки опечатки в описании сменился бы заголовок
        function lines(t) { return t.replace(/\r/g, '').split('\n').map(clean).filter(Boolean).join('\n'); }
        var isNewFormat = composeTitle(sp.speaker, sp.topic) === clean(title.value) &&
            composeWhere(wh.online, wh.place) === lines(where.value);
        lockNative(true);
        if ((title.value || where.value) && !isNewFormat) {
            preview.textContent = 'Поля разобраны из старого анонса. Если их изменить, заголовок и место запишутся в новом формате.';
        }
        form.addEventListener('submit', function () { if (touched) sync(); });
        form.insertBefore(panel, form.firstChild);
        fSpeaker.focus();
    }

    function scanForms(root) {
        // Не только в редакторе: если у формы для докладчиков та же разметка LineAct, поля появятся и там
        [].forEach.call((root || document).querySelectorAll('form#edit_element_form'), function (f) {
            if (isSeminarForm(f)) enhanceForm(f);
        });
    }

    function init() {
        scanForms();
        if (window.MutationObserver) {
            // формы LineAct подгружаются через Ajax.Updater в #main_content_place
            new MutationObserver(function () { injectStyles(); scanForms(); })
                .observe(document.body, { childList: true, subtree: true });
        }
        var events = document.querySelectorAll('.la_element_event');
        if (!events.length && !document.querySelector('.cvs-form')) return;
        injectStyles();
        renderSubscribe();
        [].forEach.call(events, function (node) {
            if (node.querySelector('.cvs-tools')) return;
            var ev;
            try { ev = parseEvent(node); } catch (e) { ev = null; }
            if (!ev) return;
            render(ev, node.querySelector('.la_element_content'));
        });
    }

    window.CVS = { parseEvent: parseEvent, buildIcs: buildIcs, splitSpeaker: splitSpeaker, splitWhere: splitWhere,
        composeTitle: composeTitle, composeWhere: composeWhere, init: init, config: CFG };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
