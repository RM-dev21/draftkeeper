// Настройки для резервного копирования в Google Drive.
// Подробная пошаговая инструкция — в файле GOOGLE_DRIVE_SETUP.md в корне проекта.
//
// Коротко: зайдите в https://console.cloud.google.com, создайте проект,
// включите Google Drive API, настройте экран согласия OAuth (тип External,
// scope .../auth/drive.file) и создайте OAuth Client ID (тип Web application).
// В "Authorized JavaScript origins" укажите адрес, с которого открывается
// приложение (например http://localhost:8080 при локальной проверке и
// https://ваш-сайт.netlify.app после публикации).
//
// Полученный Client ID (вида xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com)
// вставьте вместо пустой строки ниже. Это публичный идентификатор — не пароль
// и не секретный ключ, его не страшно хранить прямо в клиентском коде.
const GOOGLE_DRIVE_CLIENT_ID = '';
