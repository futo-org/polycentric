import { Models } from '@polycentric/polycentric-core';

export const getAccountUrl = (
    type: Long,
    value: string,
): string | undefined => {
    switch (true) {
        case type.equals(Models.ClaimType.ClaimTypeTwitter):
            return `https://x.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeYouTube):
            return `https://www.youtube.com/@${value}`;
        case type.equals(Models.ClaimType.ClaimTypeDiscord):
            return `https://discord.com/users/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeInstagram):
            return `https://instagram.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeGitHub):
            return `https://github.com/${value}`;
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
