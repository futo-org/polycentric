export const youtubeURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/;
export const shittyTestIfYoutubeIDRegex = /^[a-zA-Z0-9_-]{11}$/;
export const lbryURIRegex = /(?:lbry:\/\/)(.+)/;
export const vimeoURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com)(?:\/.+)*\/(\d+)/;
export const rumbleURLRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:rumble\.com)\/(?:embed\/|)(v[a-z0-9]+)(?:.+)/;
export const mp4URLRegex =
  /(?:https?:\/\/)?(?:[\w\-]+\.)+[\w\-]+(?:\/[\w\-]+)*\/(.+\.mp4)/;
