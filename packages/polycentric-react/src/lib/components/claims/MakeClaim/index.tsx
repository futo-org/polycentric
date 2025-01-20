import { Models, Protocol } from '@polycentric/polycentric-core';
import { useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useQueryIfAdded } from '../../../hooks/queryHooks';

export type SocialPlatform =
    | 'hackerNews'
    | 'youtube'
    | 'odysee'
    | 'rumble'
    | 'twitter'
    | 'discord'
    | 'instagram'
    | 'github'
    | 'minds'
    | 'patreon'
    | 'substack'
    | 'twitch'
    | 'website'
    | 'kick'
    | 'soundcloud'
    | 'vimeo'
    | 'nebula'
    | 'spotify'
    | 'spreadshop'
    | 'polycentric'
    | 'gitlab'
    | 'dailymotion';

export interface ClaimData {
    type: 'social' | 'occupation' | 'skill' | 'freeform';
    platform?: SocialPlatform;
    data: string | { organization: string; role: string; location: string };
}

const getPlatformClaimType = (platform: SocialPlatform): Long => {
    switch (platform) {
        case 'youtube':
            return Models.ClaimType.ClaimTypeYouTube;
        case 'twitter':
            return Models.ClaimType.ClaimTypeTwitter;
        case 'github':
            return Models.ClaimType.ClaimTypeGitHub;
        case 'discord':
            return Models.ClaimType.ClaimTypeDiscord;
        case 'instagram':
            return Models.ClaimType.ClaimTypeInstagram;
        case 'minds':
            return Models.ClaimType.ClaimTypeMinds;
        case 'odysee':
            return Models.ClaimType.ClaimTypeOdysee;
        case 'patreon':
            return Models.ClaimType.ClaimTypePatreon;
        case 'rumble':
            return Models.ClaimType.ClaimTypeRumble;
        case 'soundcloud':
            return Models.ClaimType.ClaimTypeSoundcloud;
        case 'spotify':
            return Models.ClaimType.ClaimTypeSpotify;
        case 'twitch':
            return Models.ClaimType.ClaimTypeTwitch;
        case 'vimeo':
            return Models.ClaimType.ClaimTypeVimeo;
        case 'dailymotion':
            return Models.ClaimType.ClaimTypeDailymotion;
        case 'gitlab':
            return Models.ClaimType.ClaimTypeGitlab;
        default:
            throw new Error('Invalid platform');
    }
};

const submitClaim = async (
    system: Models.PublicKey.PublicKey,
    type: 'social' | 'occupation' | 'skill' | 'freeform',
    data: any,
    platform?: SocialPlatform,
): Promise<void> => {
    let claim: Protocol.Claim;

    if (type === 'social' && platform) {
        switch (platform) {
            case 'hackerNews':
                claim = Models.claimHackerNews(data);
                break;
            case 'youtube':
                claim = Models.claimYouTube(data);
                break;
            case 'odysee':
                claim = Models.claimOdysee(data);
                break;
            case 'rumble':
                claim = Models.claimRumble(data);
                break;
            case 'twitter':
                claim = Models.claimTwitter(data);
                break;
            case 'discord':
                claim = Models.claimDiscord(data);
                break;
            case 'instagram':
                claim = Models.claimInstagram(data);
                break;
            case 'github':
                claim = Models.claimGitHub(data);
                break;
            case 'minds':
                claim = Models.claimMinds(data);
                break;
            case 'patreon':
                claim = Models.claimPatreon(data);
                break;
            case 'substack':
                claim = Models.claimSubstack(data);
                break;
            case 'twitch':
                claim = Models.claimTwitch(data);
                break;
            case 'website':
                claim = Models.claimWebsite(data);
                break;
            default:
                claim = Models.claimURL(data);
                break;
        }
    } else {
        switch (type) {
            case 'occupation':
                claim = Models.claimOccupation(
                    data.organization,
                    data.role,
                    data.location,
                );
                break;
            case 'skill':
                claim = Models.claimSkill(data);
                break;
            case 'freeform':
                claim = Models.claimGeneric(data);
                break;
            default:
                throw new Error('Invalid claim type');
        }
    }

    useQueryIfAdded(Models.ContentType.ContentTypeClaim, system, claim);
};

export const ClaimTypePopup = ({
    onClose,
    onSelect,
}: {
    onClose: () => void;
    onSelect: (type: ClaimData['type'], platform?: SocialPlatform) => void;
}) => {
    const [showSocialPlatforms, setShowSocialPlatforms] = useState(false);

    const socialPlatforms: SocialPlatform[] = [
        'youtube',
        'twitter',
        'github',
        'discord',
        'instagram',
        'minds',
        'odysee',
        'patreon',
        'rumble',
        'soundcloud',
        'spotify',
        'twitch',
        'vimeo',
        'dailymotion',
        'gitlab',
    ];

    if (showSocialPlatforms) {
        return (
            <div className="absolute bottom-14 left-0 bg-white border rounded-lg shadow-lg p-2 z-50">
                <div className="flex flex-col gap-2">
                    <button
                        onClick={() => setShowSocialPlatforms(false)}
                        className="text-left px-4 py-2 text-gray-500"
                    >
                        ← Back
                    </button>
                    {socialPlatforms.map((platform) => (
                        <button
                            key={platform}
                            onClick={() => onSelect('social', platform)}
                            className="text-left px-4 py-2 hover:bg-gray-100 rounded-md capitalize"
                        >
                            {platform}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="absolute bottom-14 left-0 bg-white border rounded-lg shadow-lg p-2 z-50">
            <div className="flex flex-col gap-2">
                <button
                    onClick={() => setShowSocialPlatforms(true)}
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Social Media
                </button>
                <button
                    onClick={() => onSelect('occupation')}
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Occupation
                </button>
                <button
                    onClick={() => onSelect('skill')}
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Skill
                </button>
                <button
                    onClick={() => onSelect('freeform')}
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Freeform
                </button>
            </div>
        </div>
    );
};

export const SocialMediaInput = ({
    system,
    platform,
    onCancel,
}: {
    system: Models.PublicKey.PublicKey;
    platform: SocialPlatform;
    onCancel: () => void;
}) => {
    const { processHandle } = useProcessHandleManager();
    const [url, setUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        try {
            setIsSubmitting(true);
            await submitClaim(system, 'social', url, platform);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold capitalize">
                    Add {platform} Profile
                </h2>
                <input
                    type="url"
                    placeholder={`Paste your ${platform} profile URL`}
                    className="border p-2 rounded-lg"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                    >
                        {isSubmitting ? 'Adding...' : 'Add'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const OccupationInput = ({
    system,
    onCancel,
}: {
    system: Models.PublicKey.PublicKey;
    onCancel: () => void;
}) => {
    const { processHandle } = useProcessHandleManager();
    const [occupation, setOccupation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        try {
            setIsSubmitting(true);
            await submitClaim(system, 'occupation', occupation);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add Occupation</h2>
                <input
                    type="text"
                    placeholder="Enter your occupation"
                    className="border p-2 rounded-lg"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                    >
                        {isSubmitting ? 'Adding...' : 'Add'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const TextInput = ({
    system,
    type,
    onCancel,
}: {
    system: Models.PublicKey.PublicKey;
    type: 'skill' | 'freeform';
    onCancel: () => void;
}) => {
    const { processHandle } = useProcessHandleManager();
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        try {
            setIsSubmitting(true);
            await submitClaim(system, type, text);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold capitalize">Add {type}</h2>
                <input
                    type="text"
                    placeholder={`Enter your ${type}`}
                    className="border p-2 rounded-lg"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                    >
                        {isSubmitting ? 'Adding...' : 'Add'}
                    </button>
                </div>
            </div>
        </div>
    );
};
