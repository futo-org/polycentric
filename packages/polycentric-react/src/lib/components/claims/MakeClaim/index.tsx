import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useState } from 'react';
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
}

interface MakeClaimProps {
    onClose: () => void;
    system: Models.PublicKey.PublicKey;
}

export const MakeClaim = ({ onClose, system }: MakeClaimProps) => {
    const [step, setStep] = useState<'type' | 'input'>('type');
    const [claimType, setClaimType] = useState<ClaimData['type'] | null>(null);
    const [platform, setPlatform] = useState<SocialPlatform | undefined>();

    console.log('MakeClaim rendered', { step, claimType, platform });

    const handleSelect = (type: ClaimData['type'], platform?: SocialPlatform) => {
        setClaimType(type);
        setPlatform(platform);
        setStep('input');
    };

    const renderInput = () => {
        if (!claimType) return null;

        const props = {
            system,
            onCancel: onClose,
        };

        switch (claimType) {
            case 'social':
                return platform ? <SocialMediaInput {...props} platform={platform} /> : null;
            case 'occupation':
                return <OccupationInput {...props} />;
            case 'skill':
            case 'freeform':
                return <TextInput {...props} type={claimType} />;
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-lg p-4 max-w-md w-full m-4" onClick={e => e.stopPropagation()}>
                {step === 'type' ? (
                    <ClaimTypePopup 
                        onClose={onClose} 
                        onSelect={handleSelect}
                        system={system}
                    />
                ) : (
                    renderInput()
                )}
            </div>
        </div>
    );
};

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

export const ClaimTypePopup = ({
    onClose,
    onSelect,
    system,
}: {
    onClose: () => void;
    onSelect: (type: ClaimData['type'], platform?: SocialPlatform) => void;
    system: Models.PublicKey.PublicKey;
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
        );
    }

    return (
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
    const [url, setUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { processHandle } = useProcessHandleManager();

    const addClaim = useCallback(async () => {
        if (!url || !processHandle) return;
        try {
            setIsSubmitting(true);
            let claim: Protocol.Claim;
            
            switch (platform) {
                case 'hackerNews':
                    claim = Models.claimHackerNews(url);
                    break;
                case 'youtube':
                    claim = Models.claimYouTube(url);
                    break;
                case 'odysee':
                    claim = Models.claimOdysee(url);
                    break;
                case 'rumble':
                    claim = Models.claimRumble(url);
                    break;
                case 'twitter':
                    claim = Models.claimTwitter(url);
                    break;
                case 'discord':
                    claim = Models.claimDiscord(url);
                    break;
                case 'instagram':
                    claim = Models.claimInstagram(url);
                    break;
                case 'github':
                    claim = Models.claimGitHub(url);
                    break;
                case 'minds':
                    claim = Models.claimMinds(url);
                    break;
                case 'patreon':
                    claim = Models.claimPatreon(url);
                    break;
                case 'substack':
                    claim = Models.claimSubstack(url);
                    break;
                case 'twitch':
                    claim = Models.claimTwitch(url);
                    break;
                case 'website':
                    claim = Models.claimWebsite(url);
                    break;
                default:
                    claim = Models.claimURL(url);
                    break;
            }
            
            await processHandle.claim(claim);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [url, platform, processHandle, onCancel]);

    return (
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
                    onClick={addClaim}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                >
                    {isSubmitting ? 'Adding...' : 'Add'}
                </button>
            </div>
        </div>
    );
};

export const OccupationInput = ({ system, onCancel }: {
    system: Models.PublicKey.PublicKey;
    onCancel: () => void;
}) => {
    const [organization, setOrganization] = useState('');
    const [role, setRole] = useState('');
    const [location, setLocation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const addClaim = useCallback(async () => {
        try {
            setIsSubmitting(true);
            const claim = Models.claimOccupation(organization, role, location);
            await useQueryIfAdded(Models.ContentType.ContentTypeClaim, system, Protocol.Claim.encode(claim).finish());
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [organization, role, location, system, onCancel]);

    return (
        <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Add Occupation</h2>
            <input
                type="text"
                placeholder="Enter your organization"
                className="border p-2 rounded-lg"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
            />
            <input
                type="text"
                placeholder="Enter your role"
                className="border p-2 rounded-lg"
                value={role}
                onChange={(e) => setRole(e.target.value)}
            />
            <input
                type="text"
                placeholder="Enter your location"
                className="border p-2 rounded-lg"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
            />
            <div className="flex justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                    Cancel
                </button>
                <button
                    onClick={addClaim}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                >
                    {isSubmitting ? 'Adding...' : 'Add'}
                </button>
            </div>
        </div>
    );
};

export const TextInput = ({ system, type, onCancel }: {
    system: Models.PublicKey.PublicKey;
    type: 'skill' | 'freeform';
    onCancel: () => void;
}) => {
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const addClaim = useCallback(async () => {
        try {
            setIsSubmitting(true);
            const claim = type === 'skill' ? 
                Models.claimSkill(text) : 
                Models.claimGeneric(text);
            await useQueryIfAdded(Models.ContentType.ContentTypeClaim, system, Protocol.Claim.encode(claim).finish());
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [text, type, system, onCancel]);

    return (
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
                    onClick={addClaim}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                >
                    {isSubmitting ? 'Adding...' : 'Add'}
                </button>
            </div>
        </div>
    );
};
