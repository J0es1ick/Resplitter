import type { Message } from 'node-telegram-bot-api';
import { screens } from '../bot/screens';
import { processReceiptPhoto } from '../services/receipt-service';
import { metrics } from '../services/metrics-service';
import { stateService } from '../services/state-service';
import { logger } from '../utils/logger';
import { sendMiniApp } from '../utils/mini-app';
import { sendReceiptWithActions } from '../utils/send-receipt-with-actions';
import { RateLimit } from '../security/rate-limit';
import { backKeyboard } from '../utils/bot-navigation';
import type { StateService } from '../services/state-service';
import type { Screen } from '../services/bot-screen-service';

export function createPhotoHandler(deps: {
  store: StateService;
  screen: Screen;
  process: typeof processReceiptPhoto;
  show: typeof sendReceiptWithActions;
  open: typeof sendMiniApp;
}) {
  const { store, screen, process, show, open } = deps;
  const photos = new RateLimit(3, 60000);
  return async function handlePhoto(msg: Message): Promise<void> {
    if (!msg.photo?.length || !msg.from) return;
    const sourceKey = msg.chat.id + ':' + msg.message_id;
    const fileUniqueId = msg.photo.at(-1)!.file_unique_id;
    const existing = store.findSource(sourceKey) || store.findPhotoSource(msg.from.id, msg.chat.id, fileUniqueId);
    const present = async (session: NonNullable<typeof existing>, reused: boolean) => {
      await store.clearFlow(msg.chat.id, msg.from!.id);
      if (session.status === 'draft') await show(msg.chat.id, session);
      else
        await open(
          msg.chat.id,
          session,
          (reused ? 'Этот чек уже есть — открываю сохранённый расчёт. Правки и выбор участников сохранены.\n\n' : '') +
            (session.status === 'finalized' ? 'Расчёт завершён. Доступен только просмотр.' : 'Откройте разделение в Mini App.'),
          msg.from!.id
        );
    };
    if (existing) {
      store.bindPhotoSource(existing, sourceKey, fileUniqueId);
      await present(existing, true);
      return;
    }
    if (!photos.allow(String(msg.from.id))) {
      await screen.show(msg.chat.id, msg.from.id, 'Слишком много фотографий. Подождите минуту и повторите.', {
        reply_markup: backKeyboard
      });
      return;
    }
    await screen.show(
      msg.chat.id,
      msg.from.id,
      'Распознаю чек. Здесь в чате проверим позиции и итог, затем перейдём к разделению в Mini App.'
    );
    let session;
    try {
      const receipt = await process(msg);
      session = await store.createSession(msg.from.id, msg.chat.id, receipt, sourceKey, { fileUniqueId });
      metrics.increment('resplitter_receipt_uploads_resolved_total');
    } catch (error) {
      logger.error('Receipt photo processing failed', { error });
      metrics.increment('resplitter_receipt_errors_total');
      await screen.show(msg.chat.id, msg.from.id, receiptErrorMessage(error), {
        reply_markup: backKeyboard
      });
      return;
    }
    await present(session, session.status !== 'draft');
  };
}
export const handlePhoto = createPhotoHandler({
  store: stateService,
  screen: screens,
  process: processReceiptPhoto,
  show: sendReceiptWithActions,
  open: sendMiniApp
});
function receiptErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('TOO_LARGE')) return 'Фото слишком большое. Отправьте изображение до 12 МБ.';
  if (message === 'OCR_NOT_CONFIGURED') return 'Сервис распознавания не настроен. Пока можно попробовать /demo.';
  if (message === 'OCR_UNREADABLE_RECEIPT') return 'Не удалось прочитать чек. Сфотографируйте его целиком, без бликов и под прямым углом.';
  if (message === 'OCR_BUSY') return 'Распознавание занято. Попробуйте через минуту.';
  return 'Не удалось обработать чек. Попробуйте ещё раз чуть позже.';
}
