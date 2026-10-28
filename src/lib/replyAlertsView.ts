export interface ReplyAlertView { id: string; reply_id: string; read_at: string | null; reply: { preview: string; lead: { business_name: string } | null } | null }
/** Count replies, not duplicate rows. */
export function unreadReplies(alerts: ReplyAlertView[]): number { return new Set(alerts.filter(a => !a.read_at).map(a => a.reply_id)).size; }
/** Explicit tab links win over the unread default. */
export function replyTab(tab: string | null, count: number): string { return tab ?? (count > 0 ? 'replies' : 'templates'); }
/** Unread first, then newest first, without mutating cached rows. */
export function orderReplies<T extends { id: string; received_at: string }>(rows: T[], unread: ReadonlySet<string>): T[] {
  return [...rows].sort((a,b) => Number(unread.has(b.id)) - Number(unread.has(a.id)) || b.received_at.localeCompare(a.received_at));
}
/** Same opt-in and background policy as Jobs, with a silent first-load baseline. */
export function replyPopups(input: { previous: ReplyAlertView[] | null; next: ReplyAlertView[]; hidden: boolean; enabled: boolean; permission: string }) {
  if (input.previous === null || !input.hidden || !input.enabled || input.permission !== 'granted') return [];
  const before = new Set(input.previous.map(a => a.reply_id));
  return input.next.filter(a => !a.read_at && !before.has(a.reply_id) && a.reply).slice(0, 3).map(a => ({
    key: a.reply_id, title: `Reply: ${a.reply!.lead?.business_name ?? 'Lead'}`, body: a.reply!.preview.split('\n')[0].slice(0, 200),
    href: `/emails?tab=replies&reply=${encodeURIComponent(a.reply_id)}`,
  }));
}
/** Relative receipt label; exact timestamp belongs in the time element's title. */
export function relativeReplyTime(receivedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(receivedAt)) / 60_000));
  if (!Number.isFinite(minutes)) return 'Time unavailable';
  if (minutes < 1) return 'Just now';
  const count = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
