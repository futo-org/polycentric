/**
 * @fileoverview Platform-specific URL regex patterns for video embedding and topic processing.
 */

// YouTube URL patterns for video ID extraction
export const youtubeURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/;
// YouTube ID validation for direct video ID input
export const shittyTestIfYoutubeIDRegex = /^[a-zA-Z0-9_-]{11}$/;
// LBRY URI pattern for decentralized video platform
export const lbryURIRegex = /(?:lbry:\/\/)(.+)/;
// Vimeo URL pattern for video ID extraction
export const vimeoURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com)(?:\/.+)*\/(\d+)/;
// Rumble URL pattern for video ID extraction
export const rumbleURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:rumble\.com)\/(?:embed\/|)(v[a-z0-9]+)(?:.+)/;
// Direct MP4 video URL pattern for video file embedding
export const mp4URLRegex =
  /(?:https?:\/\/)?(?:[\w\-]+\.)+[\w\-]+(?:\/[\w\-]+)*\/(.+\.mp4)/;
