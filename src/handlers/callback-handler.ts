import { bot } from '../bot/bot';
import { CallbackAction } from '../constants/callback-actions';
import { getChatState } from '../services/state-service';
import {
  addDish,
  back,
  changeTotal,
  cancel,
  editItemById,
  editReceipt,
  pagination,
  parseCorrect,
  parseIncorrect,
  removeDish,
  removeItemById,
  selectDishes,
  splitEvently,
  backTo
} from './data-handlers';

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

      let actionType: string;
      if (callbackData.startsWith(CallbackAction.PREV_PAGE)) {
        actionType = 'PAGINATION_PREV';
      } else if (callbackData.startsWith(CallbackAction.NEXT_PAGE)) {
        actionType = 'PAGINATION_NEXT';
      } else if (callbackData.startsWith(CallbackAction.EDIT_ITEM)) {
        actionType = 'EDIT_ITEM';
      } else if (callbackData.startsWith(CallbackAction.REMOVE_ITEM)) {
        actionType = 'REMOVE_ITEM';
      } else {
        actionType = callbackData;
      }

      switch (actionType) {
        case 'PAGINATION_PREV':
        case 'PAGINATION_NEXT':
          await pagination(callbackData, options.chatId, options.messageId);
          break;

        case CallbackAction.CHANGE_TOTAL:
          await changeTotal(state, options.chatId);
          break;

        case CallbackAction.PARSE_CORRECT:
          await parseCorrect(options.chatId);
          break;

        case CallbackAction.PARSE_INCORRECT:
          await parseIncorrect(options.chatId, options.messageId, state.receipt);
          break;

        case CallbackAction.EDIT_RECEIPT:
          await editReceipt(state, options.chatId, options.messageId);
          break;

        case CallbackAction.ADD_DISH:
          await addDish(state, options.chatId);
          break;

        case CallbackAction.REMOVE_DISH:
          await removeDish(state, options.chatId, options.messageId);
          break;

        case CallbackAction.SPLIT_EVENLY:
          await splitEvently(state, options.chatId, options.messageId);
          break;

        case CallbackAction.SELECT_DISHES:
          await selectDishes(options.chatId, options.messageId, state);
          break;

        case 'EDIT_ITEM':
          await editItemById(state, options.chatId, callbackData);
          break;

        case 'REMOVE_ITEM':
          await removeItemById(state, options.chatId, options.messageId, callbackData);
          break;

        case CallbackAction.CANCEL:
          await cancel(state, options.chatId, options.messageId);
          break;

        case CallbackAction.BACK:
          await back(options.chatId, options.messageId, state.receipt);
          break;

        case CallbackAction.BACK_TO:
          await backTo(options.chatId, options.messageId, state.receipt);
          break;

        default:
          console.error('Неизвестный запрос:', { data: callbackData });
          await bot.sendMessage(options.chatId, 'Неизвестная команда');
      }
    } catch (error) {
      console.error('Ошибка обработки запросов:', error);
      await bot.sendMessage(options.chatId, 'Произошла ошибка при обработке запроса');
    }
  });
}
