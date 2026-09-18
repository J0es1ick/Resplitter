export type CallbackAction =
  | 'confirm'
  | 'editMenu'
  | 'edit'
  | 'add'
  | 'remove'
  | 'change'
  | 'split'
  | 'select'
  | 'summary'
  | 'editItem'
  | 'removeItem'
  | 'toggle'
  | 'selectionDone'
  | 'page'
  | 'cancel'
  | 'deleteItem'
  | 'currency'
  | 'back';

const actionCodes: Record<CallbackAction, string> = {
  confirm: 'c',
  editMenu: 'em',
  edit: 'e',
  add: 'a',
  remove: 'r',
  change: 't',
  split: 's',
  select: 'd',
  summary: 'y',
  editItem: 'ei',
  removeItem: 'ri',
  toggle: 'tg',
  selectionDone: 'dn',
  page: 'p',
  cancel: 'x',
  deleteItem: 'di',
  currency: 'cu',
  back: 'b'
};

const actionsByCode = Object.fromEntries(Object.entries(actionCodes).map(([action, code]) => [code, action])) as Record<
  string,
  CallbackAction
>;

export const encodeCallback = (sessionId: string, action: CallbackAction, value?: string | number, version?: number): string => {
  const data = [
    'r',
    sessionId,
    actionCodes[action],
    value === undefined ? '' : String(value),
    ...(version === undefined ? [] : [version.toString(36)])
  ].join('.');
  if (Buffer.byteLength(data, 'utf8') > 64) throw new Error('CALLBACK_DATA_TOO_LONG');
  return data;
};

export const decodeCallback = (
  data: string
): { sessionId: string; action: CallbackAction; value?: string; version?: number } | undefined => {
  const [prefix, sessionId, code, value, rawVersion, extra] = data.split('.');
  const action = actionsByCode[code];
  if (extra !== undefined || prefix !== 'r' || !/^[A-Za-z0-9_-]{20,24}$/.test(sessionId) || !action) return undefined;
  const version = rawVersion === undefined ? undefined : /^[0-9a-z]+$/.test(rawVersion) ? parseInt(rawVersion, 36) : NaN;
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return undefined;
  return { sessionId, action, ...(value ? { value } : {}), ...(version === undefined ? {} : { version }) };
};
