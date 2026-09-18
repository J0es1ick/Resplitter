export const menuButton = { text: '← В главное меню', callback_data: 'nav:home' };
export const groupButton = { text: 'Как разделить компанией?', callback_data: 'nav:group' };
export const receiptsButton = { text: '← К списку чеков', callback_data: 'nav:receipts' };
export const currentReceiptButton = { text: '← К текущему чеку', callback_data: 'nav:current' };
export const withReceiptReturn = (keyboard: InlineKeyboardMarkup, hasReceipt: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [...(hasReceipt ? [[currentReceiptButton]] : []), ...keyboard.inline_keyboard]
});
export const backKeyboard = { inline_keyboard: [[menuButton]] };
export const helpKeyboard = { inline_keyboard: [[groupButton], [menuButton]] };
export const homeKeyboard = {
  inline_keyboard: [
    [{ text: 'Мои чеки', callback_data: 'nav:app' }],
    [{ text: 'Инструкция', callback_data: 'nav:info' }, groupButton],
    [{ text: 'Хранение данных', callback_data: 'nav:privacy' }]
  ]
};
export const mainKeyboardRows = [
  [receiptsButton],
  [{ text: 'Инструкция', callback_data: 'nav:info' }, groupButton],
  [{ text: 'Хранение данных', callback_data: 'nav:privacy' }, menuButton]
];
export const groupHelp = [
  'Как разделить чек компанией',
  '',
  'По ссылке (Telegram-группа не обязательна):',
  '1. Один человек отправляет фото боту, проверяет ВСЕ страницы и подтверждает чек.',
  '2. В Mini App нажимает «Пригласить друзей» и отправляет ссылку в общий чат.',
  '3. Каждый открывает эту ссылку со своего Telegram-аккаунта, нажимает «Запустить» в боте и открывает Mini App. Повторно загружать фото не нужно.',
  '4. Каждый отмечает свои позиции и количество. Из 3 пив один может выбрать 2, другой — 1. Для общей пиццы — «Делим вместе»: остаток после точных количеств делится поровну между выбравшими этот вариант.',
  '5. Каждый нажимает «Сохранить выбор». Во вкладке «Кто сколько» видны сохранённые доли; изменения других участников обновляются автоматически.',
  '6. Когда все участники сохранили выбор и не осталось нераспределённых частей, владелец завершает расчёт. Итог приходит в чат, куда загрузили фото.',
  '',
  'Прямо в Telegram-группе:',
  'Добавьте бота в группу. Для надёжной проверки участия бот должен быть администратором (права удаления сообщений не нужны). Отправьте фото ответом на сообщение бота, чтобы он получил его при включённом режиме приватности. Автор проверяет чек; остальные нажимают «Разделить чек» и переходят в личный чат с ботом, затем в Mini App. Итог вернётся в исходную группу. Ссылка на групповой чек доступна только текущим участникам группы.',
  '',
  'У каждого свой выбор: чужие позиции не перезаписываются. Если два человека сохранят одновременно, один может увидеть просьбу проверить обновлённые данные и повторить сохранение — введённое количество останется на экране. Больше количества в чеке выбрать нельзя.',
  'Не завершайте расчёт, пока все не подтвердили готовность. Завершить и редактировать чек может только его автор. «Назад» отменяет текущий ввод, но не удаляет чек.'
].join('\n');
import type { InlineKeyboardMarkup } from 'node-telegram-bot-api';
