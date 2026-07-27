# Настройка Google Drive для резервного копирования

Нужно один раз завести проект в Google Cloud Console — это бесплатно,
без привязки карты, займёт около 10 минут.

## 1. Создать проект
1. Открой https://console.cloud.google.com
2. Войди под своим Google-аккаунтом
3. Вверху нажми выпадающий список проектов → "New Project"
4. Название — например `draftkeeper` → Create

## 2. Включить Google Drive API
1. В левом меню: APIs & Services → Library
2. Найди "Google Drive API" → Enable

## 3. Настроить OAuth consent screen
1. APIs & Services → OAuth consent screen
2. User Type — External → Create
3. Заполни: название приложения (Draftkeeper), свой email в двух полях
4. Scopes — добавь `.../auth/drive.file` (доступ только к файлам,
   созданным приложением)
5. Test users — добавь свой собственный email (пока приложение не
   проходит проверку Google, входить смогут только email из этого списка —
   для личного использования этого достаточно)
6. Сохрани

## 4. Создать OAuth Client ID
1. APIs & Services → Credentials → Create Credentials → OAuth client ID
2. Application type — Web application
3. Authorized JavaScript origins — добавь адрес, где будет жить сайт
   (например `http://localhost:3000` для теста, и позже реальный адрес
   после того как выложишь на Netlify/Vercel)
4. Create — скопируй появившийся **Client ID**

## Что дальше
Этот Client ID нужно будет вставить в код (Claude Code покажет, куда
именно) — это не секретный пароль, это публичный идентификатор,
безопасный для использования в клиентском коде.

Примечание: пока приложение не прошло проверку Google (verification),
при входе будет показываться предупреждение "Google hasn't verified this
app" — это нормально для личного использования, нужно будет нажать
"Advanced" → "Go to Draftkeeper (unsafe)". Проверка Google нужна только
если планируешь дать доступ большому количеству посторонних пользователей.
