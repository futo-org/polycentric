import { Models } from '@polycentric/polycentric-core';

// match URLs that don't start with a slash
export const urlRegex =
    /(?:^|[^\/])(?<url>(?:http|ftp|https):\/\/(?:[\w_-]+(?:(?:\.[\w_-]+)+))(?:[\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-]))/gi;
export const topicRegex = /(?:^|\s)(?<topic>\/\S+)/gi;
export const mentionRegex = /@(?<mention>CAESI[A-Za-z0-9/+]+)/g;
export const quoteRegex = /^>.*$/gm; // Matches lines starting with >

export type LinkifyType = 'url' | 'topic' | 'mention' | 'quote';
export interface LinkifyItem {
    type: LinkifyType;
    value: string;
    start: number;
}

export const linkify = (
    content: string,
    regex: RegExp,
    key: LinkifyType,
): LinkifyItem[] => {
    const matches = [...content.matchAll(regex)];
    return matches.map((match) => ({
        type: key,
        value: key === 'quote' ? match[0] : (match.groups?.[key] ?? ''),
        start:
            (match.index ?? 0) +
            (key === 'mention'
                ? 1
                : key === 'quote'
                  ? 0
                  : match[0].indexOf(match.groups?.[key] ?? '')),
    }));
};

export const getAccountUrl = (
    type: Long,
    value: string,
): string | undefined => {
    switch (true) {
        case type.equals(Models.ClaimType.ClaimTypeTwitter):
            return `https://x.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeYouTube):
            return `${value}`;
        case type.equals(Models.ClaimType.ClaimTypeDiscord):
            return `https://discord.com/users/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeInstagram):
            return `https://instagram.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeGitHub):
            return `${value}`;
        case type.equals(Models.ClaimType.ClaimTypePatreon):
            return `https://www.patreon.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeSubstack):
            return `https://${value}.substack.com`;
        case type.equals(Models.ClaimType.ClaimTypeTwitch):
            return `https://www.twitch.tv/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeBitcoin):
            return `https://www.blockchain.com/btc/address/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeOdysee):
            return `https://odysee.com/@${value}`;
        case type.equals(Models.ClaimType.ClaimTypeRumble):
            return `https://rumble.com/user/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeMinds):
            return `https://minds.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeHackerNews):
            return `https://news.ycombinator.com/user?id=${value}`;
        case type.equals(Models.ClaimType.ClaimTypeURL):
        case type.equals(Models.ClaimType.ClaimTypeWebsite):
            return value; // Assume the value is a URL.
        default:
            return undefined; // No URL for unsupported claim types.
    }
};
