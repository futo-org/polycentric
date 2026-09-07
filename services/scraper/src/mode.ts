// Hosts that serve crawler metadata on a plain request; fetched directly rather
// than through a headless browser (faster, and some reject the browser).
const FETCH_DIRECT_DOMAINS = [
  'youtube',
  'youtu',
  'google',
  'vimeo',
  'twitter',
  'x.com',
  'soundcloud',
  'spotify',
  'reddit',
  'tiktok',
  'instagram',
  'facebook',
  'nytimes',
  'bbc',
  'imdb',
  'github',
  'wikipedia',
  'twitch',
  'bitchute',
  'dailymotion',
  'nebula',
];

export type FetchMode = 'fetch' | 'prerender';

export const fetchMode = (targetUrl: string): FetchMode => {
  try {
    const host = new URL(targetUrl).hostname;
    return FETCH_DIRECT_DOMAINS.some((d) => host.includes(d))
      ? 'fetch'
      : 'prerender';
  } catch {
    return 'prerender';
  }
};
