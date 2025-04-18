# Resplitter

Это сервис для разделения счёта в ресторане между гостями. Он построен на принципе Telegram-бота с использованием WebApp внутри самого Telegram.

В качестве стэка используется NodeJS, TypeScript. Для взаимодействия с Telegram используется Node-Telegram-bot-API.
### Краткая схема работы проекта

![Краткая логика (1)](https://github.com/user-attachments/assets/738aa7b1-edb6-42ec-b9a1-01f09cc2b18b)

В качестве библиотеки для обрабокти запросов используется Axios.

В проекте используется OCR от Yandex, следовательно для запуска приложения требуется folder-key и API-secret-key сервисвного аккаунта на https://center.yandex.cloud

## Инструкция по запуску проекта
Проект написан под NodeJS и YandexOCR, а значит нужно провести некоторые приготовления перед запуском проекта
### Предварительные приготовления
Для запуска проекта требуется установленная NodeJS.
Ниже приведены команды из официальной документации NodeJS для установки через PowerShell для Windows:
```PS
# Download and install fnm:
winget install Schniz.fnm

# Download and install Node.js:
fnm install 22

# Verify the Node.js version:
node -v # Should print "v22.14.0".

# Verify npm version:
npm -v # Should print "10.9.2".
```
Набор команд для Linux:
```bash
# Download and install fnm:
curl -o- https://fnm.vercel.app/install | bash

# Download and install Node.js:
fnm install 22

# Verify the Node.js version:
node -v # Should print "v22.14.0".

# Verify npm version:
npm -v # Should print "10.9.2".
```
В файл ⚙️.env необходимо записать:

🪙 TELEGRAM_TOKEN - токен Telegram бота для работы

🚪 API_UPLOAD_ENDPOINT и API_RESULT_ENDPOINT - https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText - входная и выходная точка OCR

🔑 API_KEY - API_SECRET_KEY каждого сервисного аккаунта на https://center.yandex.cloud

📁 API_FOLDER_KEY - идентификатор каталога по ссылке https://console.yandex.cloud/cloud/b1gr4vns0f98iqls6kee

Если каталога нет, создаете и копируете идентификатор

После установки NodeJS, необходимо установить нужные пакеты и библиотеки:
Команда для загрузки пакетов из package.json проекта
```cmd
npm i
```
Непосредственно запуск проекта
```cmd
npm run start # команда для запуска приложения
```
## Базовый юзкейс проекта
Ниже представлен базовый юзкейс проекта в виде схемы
<details>
    <summary>Базовый юзкейс проекта</summary>
    <img src="https://github.com/user-attachments/assets/68876ba9-5e46-4013-89be-3ab951b113f5" alt="Image 1">
</details>

## 🔎 Логическая схемы работы приложения
Ниже представления достаточно подробная схема работы приложения с точки зрения логики
<details>
    <summary>🧩 Основная логика приложения</summary>
    <img src="https://github.com/user-attachments/assets/d523cf4e-fc3e-4d8b-b159-5e391ebb3008" alt="Image 1">
      <details>
        <summary>❌ Функция удаления позиции</summary>
        <img src="https://github.com/user-attachments/assets/e986663e-b32d-4c06-8fd0-576793c3e93f" alt="Image 2">
      </details>
      <details>
        <summary>✅ Функция добавления</summary>
        <img src="https://github.com/user-attachments/assets/a6cfe9f6-2fd6-421b-a1ae-5bd93b0c5823" alt="Image 3">
      </details>
      <details>
        <summary>✏️ Функция изменения позиции</summary>
        <img src="https://github.com/user-attachments/assets/7adedc90-057f-46c9-bd10-1c9e83a9510f" alt="Image 4">
      </details>
</details>

## Технологический стек
В качестве основы был выбран Telegram-бот в силу того, что такая реализация больше подходит для написания MVP проекта.
MiniApp внутри Telegram относительно новая фича, которую нам показалось интересным использовать в данном проекте для реализации чекбокса в кейсе выбора блюд гостями.
Подобное решение позволило нам использовать web-технологии внутри сервиса, не обращаясь при этом к написанию полноценного отдельного сайта, а фактически web интерфейса для взаимодействия всё с тем же API, которое уже предоставлено.

node-telegram-bot-api и TypeORM являются наиболее популярными и актуальными библиотеками в своих областях, поэтому выбор при создании API был сделан именно в пользу этих библиотек.

### Почему именно OCR от Yandex?
Подобное решение было основано в первую очередь на малом количестве общедоступных данных для обучения OCR с открытым исходным кодом на кириллице. Также самые известные из моделей не предоставляют предобученных моделей на символах кириллицы,
из этого возникает необходимость обучения модели на кириллические символы, а затем уже обучение на распознавание русского текста. Чековая структура может содержать не только кириллицу, но и латиницу, а значит модель должна будет уметь распознавать оба набора симолов,
что не упрощает задачу.
