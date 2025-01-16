import { Models, Protocol } from '@polycentric/polycentric-core';
import React, { useMemo, useState } from 'react';

const getIconStringFromClaimType = (
    type: Long,
): [string | React.ReactNode | undefined, string] => {
    switch (true) {
        case type.equals(Models.ClaimType.ClaimTypeHackerNews):
            return [
                <span className="text-sm" key="hn">
                    HN
                </span>,
                '#ff6600',
            ];
        case type.equals(Models.ClaimType.ClaimTypeYouTube):
            return [
                <span className="text-sm" key="youtube">
                    youtube
                </span>,
                '#ff0000',
            ];
        case type.equals(Models.ClaimType.ClaimTypeOdysee):
            return [
                <span className="text-sm" key="odysee">
                    odysee
                </span>,
                '#cc0000',
            ];
        case type.equals(Models.ClaimType.ClaimTypeRumble):
            return [
                <span className="text-sm" key="rumble">
                    rumble
                </span>,
                '#00ff00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeTwitter):
            return [
                <span className="text-sm" key="x">
                    X
                </span>,
                '#1da1f2',
            ];
        case type.equals(Models.ClaimType.ClaimTypeBitcoin):
            return [
                <span className="text-sm" key="bitcoin">
                    bitcoin
                </span>,
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
                <span className="text-sm" key="discord">
                    discord
                </span>,
                '#7289da',
            ];
        case type.equals(Models.ClaimType.ClaimTypeInstagram):
            return [
                <span className="text-sm" key="instagram">
                    instagram
                </span>,
                '#e1306c',
            ];
        case type.equals(Models.ClaimType.ClaimTypeGitHub):
            return [
                <span className="text-sm" key="github">
                    github
                </span>,
                '#333333',
            ];
        case type.equals(Models.ClaimType.ClaimTypeMinds):
            return [
                <span className="text-sm" key="minds">
                    minds
                </span>,
                '#fcd000',
            ];
        case type.equals(Models.ClaimType.ClaimTypePatreon):
            return [
                <span className="text-sm" key="patreon">
                    patreon
                </span>,
                '#f96854',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSubstack):
            return [
                <span className="text-sm" key="substack">
                    substack
                </span>,
                '#ff6719',
            ];
        case type.equals(Models.ClaimType.ClaimTypeTwitch):
            return [
                <span className="text-sm" key="twitch">
                    twitch
                </span>,
                '#6441a5',
            ];
        case type.equals(Models.ClaimType.ClaimTypeWebsite):
            return [
                <span className="text-sm" key="url">
                    url
                </span>,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeKick):
            return [
                <span className="text-sm" key="kick">
                    kick
                </span>,
                '#00ff00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSoundcloud):
            return [
                <span className="text-xs" key="sc">
                    soundcloud
                </span>,
                '#ff8800',
            ];
        case type.equals(Models.ClaimType.ClaimTypeVimeo):
            return [
                <span className="text-sm" key="vimeo">
                    vimeo
                </span>,
                '#1ab7ea',
            ];
        case type.equals(Models.ClaimType.ClaimTypeNebula):
            return [
                <span className="text-sm" key="nebula">
                    nebula
                </span>,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeURL):
            return [
                <span className="text-sm" key="url">
                    url
                </span>,
                '#0000ff',
            ];
        case type.equals(Models.ClaimType.ClaimTypeOccupation):
            return [
                <span className="text-sm" key="occupation">
                    occupation
                </span>,
                '#cccccc',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSkill):
            return [
                <span className="text-sm" key="skill">
                    TODO
                </span>,
                '#cccccc',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSpotify):
            return [
                <span className="text-sm" key="spotify">
                    spotify
                </span>,
                '#1db954',
            ];
        case type.equals(Models.ClaimType.ClaimTypeSpreadshop):
            return [
                <span className="text-sm" key="spreadshop">
                    spreadshop
                </span>,
                '#ffcc00',
            ];
        case type.equals(Models.ClaimType.ClaimTypePolycentric):
            return [
                <span className="text-sm" key="polycentric">
                    polycentric
                </span>,
                '#ffcc00',
            ];
        case type.equals(Models.ClaimType.ClaimTypeGitlab):
            return [
                <span className="text-sm" key="gitlab">
                    gitlab
                </span>,
                '#fc6d26',
            ];
        case type.equals(Models.ClaimType.ClaimTypeDailymotion):
            return [
                <span className="text-sm" key="dm">
                    DM
                </span>,
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
    const [icon, color] = useMemo(
        () => getIconStringFromClaimType(claim.type),
        [claim.type],
    );

    return (
        <button
            className={`rounded-full w-16 h-16 p-2 flex items-center justify-center transition-all duration-300 whitespace-nowrap overflow-hidden ${
                expanded ? 'absolute w-[14rem] ' : ''
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
        >
            {expanded ? claim.field.value : icon}
        </button>
    );
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
