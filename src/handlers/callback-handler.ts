import { bot } from '../bot/bot';
import { getChatState } from '../services/state-service';
import {
  addDish,
  back,
  cancel,
  editItems,
  editReceipt,
  pagination,
  parseCorrect,
  parseIncorrect,
  removeDish,
  removeItemById,
  selectDishes,
  splitEvently
} from './data-handlers';
import { changeTotal } from './data-handlers/change-total';

const CallbackAction = {
  CHANGE_TOTAL: 'change_total',
  PARSE_CORRECT: 'parse_correct',
  PARSE_INCORRECT: 'parse_incorrect',
  EDIT_RECEIPT: 'edit_receipt',
  ADD_DISH: 'add_dish',
  REMOVE_DISH: 'remove_dish',
  SPLIT_EVENLY: 'split_evenly',
  SELECT_DISHES: 'select_dishes',
  EDIT_ITEM: 'edit_item_',
  REMOVE_ITEM: 'remove_item_',
  PREV_PAGE: 'prev:',
  NEXT_PAGE: 'next:',
  CANCEL: 'cancel',
  BACK: 'back'
} as const;

export function setupCallbackHandler() {
  bot.on('callback_query', async (qb) => {
    if (!qb.message || !qb.data) {
      console.error('Неизвестный запрос:', { callback: qb });
      return;
    }

    const options = {
      chatId: qb.message.chat.id!,
      tgId: qb.message.from?.id!,
      messageId: qb.message.message_id!
    };

    try {
      const state = getChatState(options.chatId);
      const callbackData = qb.data;

      if (!state.receipt) {
        await bot.sendMessage(options.chatId, 'Чек не найден. Пожалуйста, начните заново.');
        return;
      }

      if (callbackData.startsWith(CallbackAction.PREV_PAGE) || callbackData.startsWith(CallbackAction.NEXT_PAGE)) {
        await pagination(callbackData, options.chatId, options.messageId);
      } else if (callbackData === CallbackAction.CHANGE_TOTAL) {
        await changeTotal(state, options.chatId);
      } else if (callbackData === CallbackAction.PARSE_CORRECT) {
        await parseCorrect(options.chatId);
      } else if (callbackData === CallbackAction.PARSE_INCORRECT) {
        await parseIncorrect(options.chatId, options.messageId, state.receipt);
      } else if (callbackData === CallbackAction.EDIT_RECEIPT) {
        await editReceipt(state, options.chatId, options.messageId);
      } else if (callbackData === CallbackAction.ADD_DISH) {
        await addDish(state, options.chatId);
      } else if (callbackData === CallbackAction.REMOVE_DISH) {
        await removeDish(state, options.chatId, options.messageId);
      } else if (callbackData === CallbackAction.SPLIT_EVENLY) {
        await splitEvently(state, options.chatId, options.messageId);
      } else if (callbackData === CallbackAction.SELECT_DISHES) {
        await selectDishes(options.chatId, options.messageId);
      } else if (callbackData.startsWith(CallbackAction.EDIT_ITEM)) {
        await editItems(state, options.chatId, callbackData);
      } else if (callbackData.startsWith(CallbackAction.REMOVE_ITEM)) {
        await removeItemById(state, options.chatId, options.messageId, callbackData);
      } else if (callbackData === CallbackAction.CANCEL) {
        await cancel(state, options.chatId, options.messageId);
      } else if (callbackData === CallbackAction.BACK) {
        await back(options.chatId, options.messageId, state.receipt);
      } else {
        console.error('Неизвестный запрос:', { data: callbackData });
        await bot.sendMessage(options.chatId, 'Неизвестная команда');
      }
    } catch (error) {
      console.error('Ошибка обработки запросов:', error);
      await bot.sendMessage(options.chatId, 'Произошла ошибка при обработке запроса');
    }
  });
}
