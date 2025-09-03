import { getDMServerConfig } from '../dm/dmServerConfig';

export { getDMServerConfig };

export function generateMessageId(): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  return `dm_${timestamp}_${randomId}`;
}

export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}
