import type { ReceiptSession } from '../interfaces';
export type MemberLookup = (chatId: number, userId: number) => Promise<{ status: string; is_member?: boolean }>;
export async function requireAccess(session: ReceiptSession, userId: number, lookup: MemberLookup): Promise<void> {
  if (session.ownerUserId === userId) return;
  if (session.sourceChatId < 0) {
    let member;
    try {
      member = await lookup(session.sourceChatId, userId);
    } catch {
      throw new Error('MEMBERSHIP_UNAVAILABLE');
    }
    if (['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member)) return;
  } else if (session.participants[String(userId)]) return;
  throw new Error('SESSION_FORBIDDEN');
}
