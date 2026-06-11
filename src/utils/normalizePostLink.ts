export function normalizePostLink(
  username: string | null | undefined,
  channelId: string,
  messageId: number,
): string | null {
  if (username) {
    return `https://t.me/${username}/${messageId}`;
  }
  return `https://t.me/c/${channelId}/${messageId}`;
}
