// Настройки для резервного копирования в Google Drive.
// Подробная пошаговая инструкция — в файле GOOGLE_DRIVE_SETUP.md в корне проекта.
//
// Client ID уже создан и вписан ниже (проект в Google Cloud Console, OAuth
// Client ID типа Web application, scope .../auth/drive.file). В "Authorized
// JavaScript origins" в консоли добавлены http://localhost:8080 (локальная
// проверка) и https://rm-dev21.github.io (реальный сайт на GitHub Pages).
// Это публичный идентификатор — не пароль и не секретный ключ, его не
// страшно хранить прямо в клиентском коде.
const GOOGLE_DRIVE_CLIENT_ID = '1075596504298-o6lpjqn8vc3tbno4hptosh0u2j85q4sc.apps.googleusercontent.com';
