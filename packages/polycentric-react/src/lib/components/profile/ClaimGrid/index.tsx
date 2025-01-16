import { Models, Protocol } from '@polycentric/polycentric-core';
import React, { useMemo, useState } from 'react';

import YouTubeIcon from '../../../../graphics/icons/rendered/youtube.svg.png';
import TwitterIcon from '../../../../graphics/icons/rendered/twitter.svg.png';
import RumbleIcon from '../../../../graphics/icons/rendered/rumble.svg.png';
import OdyseeIcon from '../../../../graphics/icons/rendered/odysee.svg.png';
import DiscordIcon from '../../../../graphics/icons/rendered/discord.svg.png';
import InstagramIcon from '../../../../graphics/icons/rendered/instagram.svg.png';
import GitHubIcon from '../../../../graphics/icons/rendered/github.svg.png';
import MindsIcon from '../../../../graphics/icons/rendered/minds.svg.png';
import PatreonIcon from '../../../../graphics/icons/rendered/patreon.svg.png';
import SubstackIcon from '../../../../graphics/icons/rendered/substack.svg.png';
import TwitchIcon from '../../../../graphics/icons/rendered/twitch.svg.png';
import BitcoinIcon from '../../../../graphics/icons/rendered/bitcoin.svg.png';
import HackerNewsIcon from '../../../../graphics/icons/rendered/hackernews.svg.png';
import URLIcon from '../../../../graphics/icons/rendered/url.svg.png';
import WebsiteIcon from '../../../../graphics/icons/rendered/website.svg.png';
import WorkIcon from '../../../../graphics/icons/rendered/work.svg.png';
import KickIcon from '../../../../graphics/icons/rendered/kick.svg.png';
import SoundCloudIcon from '../../../../graphics/icons/rendered/soundcloud.svg.png';
import VimeoIcon from '../../../../graphics/icons/rendered/vimeo.svg.png';
import NebulaIcon from '../../../../graphics/icons/rendered/nebula.svg.png';
import SpotifyIcon from '../../../../graphics/icons/rendered/spotify.svg.png';
import SpreadshopIcon from '../../../../graphics/icons/rendered/spreadshop.svg.png';
import GitlabIcon from '../../../../graphics/icons/rendered/gitlab.svg.png';
import DailyMotionIcon from '../../../../graphics/icons/rendered/dailymotion.svg.png';
import PolycentricIcon from '../../../../graphics/icons/rendered/polycentric.svg.png';
import SkillIcon from '../../../../graphics/icons/rendered/gear.svg.png';

const getIconFromClaimType = (
    type: Long,
): [string | React.ReactNode | undefined, string] => {
    switch (true) {
        case type.equals(Models.ClaimType.ClaimTypeHackerNews):
            return [
                <img src={HackerNewsIcon} alt="Hacker News" className="w-6 h-6" />,
                '#ff6600',
            ];
        case type.equals(Models.ClaimType.ClaimTypeYouTube):
            return [
                <img src={YouTubeIcon} alt="YouTube" className="w-6 h-6" />,
                '#ff0000',
            ];
        case type.equals(Models.ClaimType.ClaimTypeOdysee):
            return [
                <img src={OdyseeIcon} alt="Odysee" className="w-6 h-6" />,
                '#cc0000',
            ];
        case type.equals(Models.ClaimType.ClaimTypeRumble):
            return [
                <img src={RumbleIcon} alt="Rumble" className="w-6 h-6" />,
                '#00ff00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeTwitter):
            return [
                <img src={TwitterIcon} alt="X" className="w-6 h-6" />,
                '#1da1f2',
            ];
        case type.equals(Models.ClaimType.ClaimTypeBitcoin):
            return [
                <img src={BitcoinIcon} alt="Bitcoin" className="w-6 h-6" />,
                '#f7931a',
            ];
        case type.equals(Models.ClaimType.ClaimTypeGeneric):
            return [
                <span className="text-sm" key="generic">
                    ?
                </span>,
                '#cccccc',
            ];
        case type.equals(Models.ClaimType.ClaimTypeDiscord):
            return [
                <img src={DiscordIcon} alt="Discord" className="w-6 h-6" />,

                '#7289da',
            ];
        case type.equals(Models.ClaimType.ClaimTypeInstagram):
            return [
                <img src={InstagramIcon} alt="Instagram" className="w-6 h-6" />,
                '#e1306c',
            ];
        case type.equals(Models.ClaimType.ClaimTypeGitHub):
            return [
                <img src={GitHubIcon} alt="Github" className="w-6 h-6" />,
                '#333333',
            ];
        case type.equals(Models.ClaimType.ClaimTypeMinds):
            return [
                <img src={MindsIcon} alt="Minds" className="w-6 h-6" />,
                '#fcd000',
            ];
        case type.equals(Models.ClaimType.ClaimTypePatreon):
            return [
                <img src={PatreonIcon} alt="Patreon" className="w-6 h-6" />,
                '#f96854',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSubstack):
            return [
                <img src={SubstackIcon} alt="Substack" className="w-6 h-6" />,
                '#ff6719',
            ];
        case type.equals(Models.ClaimType.ClaimTypeTwitch):
            return [
                <img src={TwitchIcon} alt="Twitch" className="w-6 h-6" />,
                '#6441a5',
            ];
        case type.equals(Models.ClaimType.ClaimTypeWebsite):
            return [
                <img src={WebsiteIcon} alt="Website" className="w-6 h-6" />,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeKick):
            return [
                <img src={KickIcon} alt="Kick" className="w-6 h-6" />,
                '#00ff00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSoundcloud):
            return [
                <img src={SoundCloudIcon} alt="Soundcloud" className="w-6 h-6" />,
                '#ff8800',
            ];
        case type.equals(Models.ClaimType.ClaimTypeVimeo):
            return [
                <img src={VimeoIcon} alt="Vimeo" className="w-6 h-6" />,
                '#1ab7ea',
            ];
        case type.equals(Models.ClaimType.ClaimTypeNebula):
            return [
                <img src={NebulaIcon} alt="Nebula" className="w-6 h-6" />,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeURL):
            return [
                <img src={URLIcon} alt="URL" className="w-6 h-6" />,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeOccupation):
            return [
                <img src={WorkIcon} alt="Work" className="w-6 h-6" />,
                '#cccccc',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSkill):
            return [
                <img src={SkillIcon} alt="Skill" className="w-6 h-6" />,
                '#cccccc',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSpotify):
            return [
                <img src={SpotifyIcon} alt="Spotify" className="w-6 h-6" />,
                '#1db954',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSpreadshop):
            return [
                <img src={SpreadshopIcon} alt="Spreadshop" className="w-6 h-6" />,
                '#ffcc00',
            ];
        case type.equals(Models.ClaimType.ClaimTypePolycentric):
            return [
                <img src={PolycentricIcon} alt="Polycentric" className="w-6 h-6" />,
                '#ffcc00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeGitlab):
            return [
                <img src={GitlabIcon} alt="Gitlab" className="w-6 h-6" />,
                '#fc6d26',
            ];
        case type.equals(Models.ClaimType.ClaimTypeDailymotion):
            return [
                <img src={DailyMotionIcon} alt="Dailymotion" className="w-6 h-6" />,
                '#0066dc',
            ];
        default:
            return [
                <span className="text-sm" key="default">
                    ?
                </span>,
                '#cccccc',
            ];
    }
};

const ClaimCircle: React.FC<{
    claim: { field: { value: string }; type: Long };
    position: 'start' | 'middle' | 'end';
}> = ({ claim, position }) => {
    const [expanded, setExpanded] = useState(false);
    const [icon, color] = useMemo(() => getIconFromClaimType(claim.type), [claim.type]);
    const url = useMemo(() => getAccountUrl(claim.type, claim.field.value), [claim.type, claim.field.value]);

    const handleClick = () => {
        if (url) {
            window.open(url, '_blank');
        }
    };

    return (
        <button
            className={`rounded-full w-16 h-16 p-2 flex items-center justify-center transition-all duration-300 whitespace-nowrap overflow-hidden ${
                expanded ? 'absolute w-[14rem]' : ''
            } ${
                position === 'start'
                    ? 'left-0'
                    : position === 'middle'
                    ? expanded
                        ? '-translate-x-[5rem]'
                        : ''
                    : expanded
                    ? '-translate-x-[10rem]'
                    : ''
            }`}
            style={{ backgroundColor: color }}
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            onClick={handleClick}
        >
            {expanded ? claim.field.value : icon}
        </button>
    );
};

const getAccountUrl = (
    type: Long, value: string
): string | undefined => {
    switch (true) {
        case type.equals(Models.ClaimType.ClaimTypeTwitter):
            return `https://twitter.com/${value}`;
        case type.equals(Models.ClaimType.ClaimTypeYouTube):
            return `https://www.youtube.com/channel/${value}`;
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
        case type.equals(Models.ClaimType.ClaimTypeURL):
        case type.equals(Models.ClaimType.ClaimTypeWebsite):
            return value; // Assume the value is a URL.
        default:
            return undefined; // No URL for unsupported claim types.
    }
};

export const ClaimGrid: React.FC<{ claims: Protocol.Claim[] }> = ({
    claims,
}) => {
    const claimsUnwrapped = useMemo(() => {
        const out = [];
        for (const claim of claims) {
            for (const field of claim.claimFields) {
                out.push({ field, type: claim.claimType });
            }
        }
        return out;
    }, [claims]);

    const claimsInGroupsOfThree = useMemo(() => {
        const out = [];
        for (let i = 0; i < claimsUnwrapped.length; i += 3) {
            out.push(claimsUnwrapped.slice(i, i + 3));
        }
        return out;
    }, [claimsUnwrapped]);

    return (
        <div className="flex flex-col items-center justify-center space-y-3">
            <div className="text-center text-xl font-semibold">Claims</div>
            {claimsInGroupsOfThree.map((group, index) => (
                <div key={index} className="grid relative grid-cols-3 gap-4">
                    {group.map((claim, index) => (
                        <div key={index} className="w-16 h-16">
                            <ClaimCircle
                                claim={claim}
                                position={
                                    index === 0
                                        ? 'start'
                                        : index === 1
                                        ? 'middle'
                                        : 'end'
                                }
                            />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};
