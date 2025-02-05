import * as Core from '@polycentric/polycentric-core';
import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { getOAuthURL } from '../../../util/oauth';
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

export const isOAuthVerifiable = (claimType: Core.Models.ClaimType.ClaimType): boolean => {
    return (
        claimType.equals(Core.Models.ClaimType.ClaimTypeDiscord) ||
        claimType.equals(Core.Models.ClaimType.ClaimTypeTwitter) ||
        claimType.equals(Core.Models.ClaimType.ClaimTypeInstagram)
    );
};

export const MakeClaim = ({ onClose, system }: MakeClaimProps) => {
    const [step, setStep] = useState<'type' | 'input'>('type');
    const [claimType, setClaimType] = useState<ClaimData['type'] | null>(null);
    const [platform, setPlatform] = useState<SocialPlatform | undefined>();

    const handleSelect = (
        type: ClaimData['type'],
        platform?: SocialPlatform,
    ) => {
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
                return platform ? (
                    <SocialMediaInput {...props} platform={platform} />
                ) : null;
            case 'occupation':
                return <OccupationInput {...props} />;
            case 'skill':
            case 'freeform':
                return <TextInput {...props} type={claimType} />;
        }
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-lg p-4 max-w-md w-full m-4"
                onClick={(e) => e.stopPropagation()}
            >
                {step === 'type' ? (
                    <ClaimTypePopup onSelect={handleSelect} />
                ) : (
                    renderInput()
                )}
            </div>
        </div>
    );
};

export const ClaimTypePopup = ({
    onSelect,
}: {
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

const getPlatformHelpText = (platform: SocialPlatform): string => {
    switch (platform) {
        case 'youtube':
            return "Add this token anywhere to your YouTube channel description.";
        case 'odysee':
            return "Add this token anywhere to your Odysee channel description.";
        case 'rumble':
            return "Add this token anywhere to the description of your latest video.";
        case 'twitch':
            return "Add this token anywhere to your Twitch bio.";
        case 'instagram':
            return "Add this token anywhere to your Instagram bio.";
        case 'minds':
            return "Add this token anywhere to your Minds bio.";
        case 'patreon':
            return "Add this token anywhere to your Patreon bio.";
        case 'substack':
            return "Add this token anywhere to your Substack about page.";
        default:
            return "";
    }
};

const isVerifiablePlatform = (platform: SocialPlatform): boolean => {
    console.log('Checking if platform is verifiable:', platform);
    const result = ['youtube', 'odysee', 'rumble', 'twitch', 'instagram', 'minds', 'patreon', 'substack'].includes(platform);
    console.log('Is verifiable:', result);
    return result;
};

export const SocialMediaInput = ({
    platform,
    onCancel,
}: {
    platform: SocialPlatform;
    onCancel: () => void;
}) => {
    const [url, setUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [verificationStep, setVerificationStep] = useState<'input' | 'token' | 'verifying'>('input');
    const [claimPointer, setClaimPointer] = useState<string | null>(null);
    const { processHandle } = useProcessHandleManager();

    // Check for OAuth verification immediately
    useEffect(() => {
        const checkOAuth = async () => {
            let claimType: Core.Models.ClaimType.ClaimType;
            switch (platform) {
                case 'twitter':
                    claimType = Core.Models.ClaimType.ClaimTypeTwitter;
                    break;
                case 'discord':
                    claimType = Core.Models.ClaimType.ClaimTypeDiscord;
                    break;
                case 'instagram':
                    claimType = Core.Models.ClaimType.ClaimTypeInstagram;
                    break;
                default:
                    return;
            }

            if (isOAuthVerifiable(claimType)) {
                try {
                    // Don't create claim yet, just get the OAuth URL
                    const oauthUrl = await getOAuthURL(claimType);
                    window.location.href = oauthUrl;
                } catch (error) {
                    console.error('OAuth URL fetch failed:', error);
                }
            }
        };
        checkOAuth();
    }, [platform]);

    const addClaim = useCallback(async () => {
        if (!url || !processHandle) return;
        try {
            setIsSubmitting(true);
            let claim: Protocol.Claim;
            let claimType: Core.Models.ClaimType.ClaimType;

            // Ensure URL has proper protocol
            const processedUrl = url.startsWith('http') ? url : `https://${url}`;

            switch (platform) {
                case 'hackerNews':
                    claim = Models.claimHackerNews(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeHackerNews;
                    break;
                case 'youtube':
                    claim = Models.claimYouTube(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeYouTube;
                    break;
                case 'odysee':
                    claim = Models.claimOdysee(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeOdysee;
                    break;
                case 'rumble':
                    claim = Models.claimRumble(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeRumble;
                    break;
                case 'github':
                    claim = Models.claimGitHub(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeGitHub;
                    break;
                case 'minds':
                    claim = Models.claimMinds(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeMinds;
                    break;
                case 'patreon':
                    claim = Models.claimPatreon(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypePatreon;
                    break;
                case 'substack':
                    claim = Models.claimSubstack(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeSubstack;
                    break;
                case 'twitch':
                    claim = Models.claimTwitch(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeTwitch;
                    break;
                case 'website':
                    claim = Models.claimWebsite(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeWebsite;
                    break;
                default:
                    claim = Models.claimURL(processedUrl);
                    claimType = Core.Models.ClaimType.ClaimTypeURL;
                    break;
            }

            // Create the claim first
            const pointer = await processHandle.claim(claim);
            
            if (isOAuthVerifiable(claimType)) {
                const oauthUrl = await getOAuthURL(claimType);
                window.location.href = oauthUrl;
            } else if (isVerifiablePlatform(platform)) {
                // Convert PublicKey key to base64 token
                const bytes = Array.from(pointer.system.key);
                const token = btoa(String.fromCharCode.apply(null, bytes));
                setClaimPointer(token);
                setVerificationStep('token');
            } else {
                onCancel();
            }
        } catch (error) {
            console.error('Failed to submit claim:', error);
            onCancel();
        } finally {
            setIsSubmitting(false);
        }
    }, [url, platform, processHandle, onCancel]);

    const startVerification = useCallback(async () => {
        setVerificationStep('verifying');
        // Here you would implement the verification check
        // Similar to your AutomatedVerificationPage
        // For now, we'll just show a loading state
        setTimeout(() => {
            onCancel();
        }, 2000);
    }, [onCancel]);

    // Add some debug logging to verify the flow
    useEffect(() => {
        console.log('Current verification step:', verificationStep);
        console.log('Current claim pointer:', claimPointer);
    }, [verificationStep, claimPointer]);

    if (verificationStep === 'token' && claimPointer) {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add Token</h2>
                <div className="bg-gray-800 p-4 rounded-lg">
                    <p className="text-white font-mono break-all">{claimPointer}</p>
                    <button 
                        onClick={() => navigator.clipboard.writeText(claimPointer)}
                        className="text-gray-400 text-sm mt-2 hover:text-gray-300"
                    >
                        Tap to copy
                    </button>
                </div>
                <p className="text-sm text-gray-600">
                    {getPlatformHelpText(platform)}
                    You may remove it after verification is complete. 
                    It may take a few minutes after updating for verification to succeed.
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={startVerification}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        Verify
                    </button>
                </div>
            </div>
        );
    }

    if (verificationStep === 'verifying') {
        return (
            <div className="flex flex-col items-center gap-4 p-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p>Verifying your claim...</p>
            </div>
        );
    }

    // Original input UI
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
                onChange={(e) => {
                    console.log('URL changed:', e.target.value);
                    setUrl(e.target.value);
                }}
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
                    onMouseDown={() => console.log('Button mouse down')}
                    onMouseUp={() => console.log('Button mouse up')}
                    onMouseEnter={() => console.log('Button mouse enter')}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? 'Adding...' : 'Add'}
                </button>
            </div>
        </div>
    );
};

export const OccupationInput = ({ onCancel }: { onCancel: () => void }) => {
    const [organization, setOrganization] = useState('');
    const [role, setRole] = useState('');
    const [location, setLocation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { processHandle } = useProcessHandleManager();

    const addClaim = useCallback(async () => {
        if (!processHandle) return;
        try {
            setIsSubmitting(true);
            const claim = Models.claimOccupation(organization, role, location);
            await processHandle.claim(claim);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [organization, role, location, processHandle, onCancel]);

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

export const TextInput = ({
    type,
    onCancel,
}: {
    type: 'skill' | 'freeform';
    onCancel: () => void;
}) => {
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { processHandle } = useProcessHandleManager();

    const addClaim = useCallback(async () => {
        if (!processHandle) return;
        try {
            setIsSubmitting(true);
            const claim =
                type === 'skill'
                    ? Models.claimSkill(text)
                    : Models.claimGeneric(text);
            await processHandle.claim(claim);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [text, type, processHandle, onCancel]);

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
