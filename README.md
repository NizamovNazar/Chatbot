# OA Smart Assistant

## Запуск (локально)

1) Встановити залежності

```bash
cd server
npm install

cd ..\web
npm install
```

2) Індексувати сайти

```bash
cd ..\server
npm run index
```

3) Запустити backend

```bash
npm run dev
```

4) Запустити frontend (інший термінал)

```bash
cd ..\web
npm run dev
```

## Налаштування

- `GROQ_API_KEY` у `.env`
- `GROQ_MODEL` у `.env`
- `SITE_URLS` у `.env`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` у `.env`

## Мок API для розкладу

Файл мок-розкладу:

- `server/data/mock_schedule.json`

Ендпоінти:

- `GET /api/mock/schedule/groups` — список груп
- `GET /api/mock/schedule/bells` — розклад дзвінків
- `GET /api/mock/schedule?group=МУП-1&day=mon&lang=uk` — розклад на день
- `GET /api/mock/schedule?group=МУП-1&range=week&lang=uk` — розклад на тиждень

У чаті запити про розклад/дзвінки тепер обробляються через мок API автоматично.

## Реальний розклад (логін/пароль локально)

Щоб читати реальний розклад через авторизовану сесію:

1. Додай у `server/.env`:
   - `SCHEDULE_LOGIN_URL=...`
   - `SCHEDULE_LOGIN_POST_URL=...` (опційно, якщо POST-адреса інша)
   - `SCHEDULE_PAGE_URL=...`
   - `SCHEDULE_USER_FIELD=email` (або назва поля логіну у формі)
   - `SCHEDULE_PASS_FIELD=password` (або назва поля паролю у формі)
   - `SCHEDULE_CSRF_FIELD=_token` (опційно)

2. Увійди в сесію (пароль не зберігається на диск, тільки в пам'яті процесу):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/schedule/login -ContentType "application/json" -Body '{"adminEmail":"admin@oa.edu.ua","adminPassword":"Admin#2026","username":"YOUR_LOGIN","password":"YOUR_PASSWORD"}'
```

3. Статус сесії:

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/schedule/status
```

4. Вийти із сесії:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/schedule/logout -ContentType "application/json" -Body '{"adminEmail":"admin@oa.edu.ua","adminPassword":"Admin#2026"}'
```

### Якщо вхід через Google SSO (без CAPTCHA)

Для SSO-варіанту логін/пароль endpoint може не спрацювати. Тоді використовуй cookie-сесію:

1. У браузері увійди в UM System і відкрий сторінку розкладу.
2. В DevTools скопіюй `Cookie` header для запиту до `umsys.com.ua`.
3. Передай cookie на локальний бекенд:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/schedule/session-cookies -ContentType "application/json" -Body '{"adminEmail":"1","adminPassword":"1","user":"nazarko","cookie":"XSRF-TOKEN=...; laravel_session=..."}'
```

Після цього чат працюватиме у live-режимі доти, доки сесія cookie валідна.

