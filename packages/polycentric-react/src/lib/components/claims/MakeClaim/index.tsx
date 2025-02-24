import * as Core from '@polycentric/polycentric-core';
import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useClaims } from '../../../hooks/queryHooks';

export type SocialPlatform =
    | 'hackerNews'
    | 'youtube'
    | 'odysee'
    | 'rumble'
    | 'twitter/X'
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

const isOAuthVerifiable = (
    claimType: Core.Models.ClaimType.ClaimType,
): boolean => {
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
    const [futoIDSecret, setFutoIDSecret] = useState('');

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
        'twitter/X',
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
            return 'Add this token anywhere to your YouTube channel description.';
        case 'odysee':
            return 'Add this token anywhere to your Odysee channel description.';
        case 'rumble':
            return 'Add this token anywhere to the description of your latest video.';
        case 'twitch':
            return 'Add this token anywhere to your Twitch bio.';
        case 'instagram':
            return 'Add this token anywhere to your Instagram bio.';
        case 'minds':
            return 'Add this token anywhere to your Minds bio.';
        case 'patreon':
            return 'Add this token anywhere to your Patreon bio.';
        case 'substack':
            return 'Add this token anywhere to your Substack about page.';
        default:
            return '';
    }
};

const isVerifiablePlatform = (platform: SocialPlatform): boolean => {
    const result = [
        'youtube',
        'odysee',
        'rumble',
        'twitch',
        'instagram',
        'minds',
        'patreon',
        'substack',
    ].includes(platform);
    return result;
};

const handleOAuthLogin = async (claimType: Core.Models.ClaimType.ClaimType) => {
    try {
        const redirectUri = `${window.location.origin}/oauth/callback`;
        const oauthUrl = await Core.APIMethods.getOAuthURL(
            Core.APIMethods.VERIFIER_SERVER,
            claimType,
            redirectUri
        );

        // Store debug info in localStorage
        localStorage.setItem('oauth_debug_url', oauthUrl);
        
        const url = new URL(oauthUrl);
        const secret = url.searchParams.get('harborSecret') || '';
        localStorage.setItem('oauth_debug_secret', secret);
        localStorage.setItem('futoIDSecret', secret);

        // Navigate to OAuth URL
        window.location.href = oauthUrl;
    } catch (error) {
        console.error('OAuth initialization failed:', error);
    }
};

export const SocialMediaInput = ({
    platform,
    system,
    onCancel,
}: {
    platform: SocialPlatform;
    system: Models.PublicKey.PublicKey;
    onCancel: () => void;
}) => {
    const [url, setUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [verificationStep, setVerificationStep] = useState<
        'input' | 'token' | 'verifying' | 'success' | 'error' | 'duplicate'
    >('input');
    const [claimPointer, setClaimPointer] = useState<Protocol.Pointer | null>(
        null,
    );
    const { processHandle } = useProcessHandleManager();
    const claims = useClaims(system);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const initializeOAuth = async () => {
            if (!platform) return;

            const claimType = getClaimTypeForPlatform(platform);

            if (isOAuthVerifiable(claimType)) {
                await handleOAuthLogin(claimType);
            }
        };

        initializeOAuth();
    }, [platform]);

    const addClaim = useCallback(async () => {
        if (!url || !processHandle || !claims) return;
        try {
            setIsSubmitting(true);

            // Check for existing claims first
            const existingClaim = claims.find((claim) => {
                switch (platform) {
                    case 'youtube':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeYouTube,
                        );
                    case 'twitter/X':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeTwitter,
                        );
                    case 'discord':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeDiscord,
                        );
                    case 'instagram':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeInstagram,
                        );
                    case 'github':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeGitHub,
                        );
                    case 'minds':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeMinds,
                        );
                    case 'odysee':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeOdysee,
                        );
                    case 'rumble':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeRumble,
                        );
                    case 'vimeo':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeVimeo,
                        );
                    case 'nebula':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeNebula,
                        );
                    case 'spotify':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeSpotify,
                        );
                    case 'spreadshop':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeSpreadshop,
                        );
                    case 'website':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeWebsite,
                        );
                    case 'patreon':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypePatreon,
                        );
                    case 'substack':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeSubstack,
                        );
                    case 'twitch':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeTwitch,
                        );
                    case 'dailymotion':
                        return claim.value.claimType.equals(
                            Core.Models.ClaimType.ClaimTypeDailymotion,
                        );

                    default:
                        return false;
                }
            });

            if (existingClaim) {
                setVerificationStep('duplicate');
                setIsSubmitting(false);
                return;
            }

            // Create the claim
            let claim: Protocol.Claim;
            let claimType: Core.Models.ClaimType.ClaimType;

            // Ensure URL has proper protocol
            const processedUrl = url.startsWith('http')
                ? url
                : `https://${url}`;

            switch (platform) {
                case 'hackerNews':
                    claimType = Core.Models.ClaimType.ClaimTypeHackerNews;
                    claim = Models.claimHackerNews(processedUrl);
                    break;
                case 'youtube':
                    claimType = Core.Models.ClaimType.ClaimTypeYouTube;
                    claim = Models.claimYouTube(processedUrl);
                    break;
                case 'odysee':
                    claimType = Core.Models.ClaimType.ClaimTypeOdysee;
                    claim = Models.claimOdysee(processedUrl);
                    break;
                case 'rumble':
                    claimType = Core.Models.ClaimType.ClaimTypeRumble;
                    claim = Models.claimRumble(processedUrl);
                    break;
                case 'github':
                    claimType = Core.Models.ClaimType.ClaimTypeGitHub;
                    claim = Models.claimGitHub(processedUrl);
                    break;
                case 'minds':
                    claimType = Core.Models.ClaimType.ClaimTypeMinds;
                    claim = Models.claimMinds(processedUrl);
                    break;
                case 'patreon':
                    claimType = Core.Models.ClaimType.ClaimTypePatreon;
                    claim = Models.claimPatreon(processedUrl);
                    break;
                case 'substack':
                    claimType = Core.Models.ClaimType.ClaimTypeSubstack;
                    claim = Models.claimSubstack(processedUrl);
                    break;
                case 'twitch':
                    claimType = Core.Models.ClaimType.ClaimTypeTwitch;
                    claim = Models.claimTwitch(processedUrl);
                    break;
                case 'website':
                    claimType = Core.Models.ClaimType.ClaimTypeWebsite;
                    claim = Models.claimWebsite(processedUrl);
                    break;
                case 'vimeo':
                    claimType = Core.Models.ClaimType.ClaimTypeVimeo;
                    claim = Models.claimVimeo(processedUrl);
                    break;
                case 'nebula':
                    claimType = Core.Models.ClaimType.ClaimTypeNebula;
                    claim = Models.claimNebula(processedUrl);
                    break;
                case 'spotify':
                    claimType = Core.Models.ClaimType.ClaimTypeSpotify;
                    claim = Models.claimSpotify(processedUrl);
                    break;
                case 'spreadshop':
                    claimType = Core.Models.ClaimType.ClaimTypeSpreadshop;
                    claim = Models.claimSpreadshop(processedUrl);
                    break;
                default:
                    claimType = Core.Models.ClaimType.ClaimTypeURL;
                    claim = Models.claimURL(processedUrl);
                    break;
            }

            // Create the claim and store the full pointer
            const pointer = await processHandle.claim(claim);
            setClaimPointer(pointer);

            if (isVerifiablePlatform(platform)) {
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
    }, [url, platform, processHandle, claims, onCancel]);

    const startVerification = useCallback(async () => {
        if (!processHandle || !claimPointer) return;

        setVerificationStep('verifying');

        try {
            await Core.ProcessHandle.fullSync(processHandle);

            await Core.APIMethods.requestVerification(
                claimPointer,
                getClaimTypeForPlatform(platform),
            );

            setVerificationStep('success');
            setTimeout(() => {
                onCancel();
            }, 2000);
        } catch (error) {
            setVerificationStep('error');
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : 'An unknown error occurred with the verification server.',
            );
        }
    }, [processHandle, claimPointer, platform, onCancel]);

    // Helper function to convert platform to claim type
    const getClaimTypeForPlatform = (
        platform: SocialPlatform,
    ): Core.Models.ClaimType.ClaimType => {
        switch (platform) {
            case 'youtube':
                return Models.ClaimType.ClaimTypeYouTube;
            case 'twitter/X':
                return Core.Models.ClaimType.ClaimTypeTwitter;
            case 'discord':
                return Core.Models.ClaimType.ClaimTypeDiscord;
            case 'instagram':
                return Core.Models.ClaimType.ClaimTypeInstagram;
            case 'github':
                return Core.Models.ClaimType.ClaimTypeGitHub;
            case 'minds':
                return Core.Models.ClaimType.ClaimTypeMinds;
            case 'odysee':
                return Core.Models.ClaimType.ClaimTypeOdysee;
            case 'rumble':
                return Core.Models.ClaimType.ClaimTypeRumble;
            case 'patreon':
                return Core.Models.ClaimType.ClaimTypePatreon;
            case 'substack':
                return Core.Models.ClaimType.ClaimTypeSubstack;
            case 'twitch':
                return Core.Models.ClaimType.ClaimTypeTwitch;
            // Add other platform mappings as needed
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    };

    if (verificationStep === 'token' && claimPointer) {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add Token</h2>
                <div className="bg-gray-800 p-4 rounded-lg">
                    <p className="text-white font-mono break-all">
                        {btoa(
                            String.fromCharCode.apply(
                                null,
                                Array.from(claimPointer!.system!.key),
                            ),
                        )}
                    </p>
                    <button
                        onClick={() =>
                            navigator.clipboard.writeText(
                                btoa(
                                    String.fromCharCode.apply(
                                        null,
                                        Array.from(claimPointer!.system!.key),
                                    ),
                                ),
                            )
                        }
                        className="text-gray-400 text-sm mt-2 hover:text-gray-300"
                    >
                        Tap to copy
                    </button>
                </div>
                <p className="text-sm text-gray-600">
                    {getPlatformHelpText(platform)}
                    You may remove it after verification is complete. It may
                    take a few minutes after updating for verification to
                    succeed.
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

    if (verificationStep === 'success') {
        return (
            <div className="flex flex-col items-center gap-4 p-4">
                <div className="text-green-500">✓</div>
                <p>Verification successful!</p>
            </div>
        );
    }

    if (verificationStep === 'error') {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-center text-red-500">
                    Verification Failed
                </h2>
                <p className="text-center text-gray-600">{errorMessage}</p>
                <div className="flex justify-center mt-4">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    if (verificationStep === 'duplicate') {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-center">
                    You&apos;ve already claimed this profile
                </h2>
                <div className="flex justify-center mt-4">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        OK
                    </button>
                </div>
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
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-blue-300"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? 'Adding...' : 'Add'}
                </button>
            </div>
        </div>
    );
};

export const OccupationInput = ({
    onCancel,
    system,
}: {
    onCancel: () => void;
    system: Models.PublicKey.PublicKey;
}) => {
    const [organization, setOrganization] = useState('');
    const [role, setRole] = useState('');
    const [location, setLocation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [verificationStep, setVerificationStep] = useState<
        'input' | 'duplicate'
    >('input');
    const { processHandle } = useProcessHandleManager();
    const claims = useClaims(system);

    const addClaim = useCallback(async () => {
        if (!processHandle || !claims) return;
        try {
            setIsSubmitting(true);

            // Check for existing claims
            const existingClaim = claims.find(
                (claim) =>
                    claim.value.claimType.equals(
                        Core.Models.ClaimType.ClaimTypeOccupation,
                    ) &&
                    claim.value.claimFields[0]?.value === organization &&
                    claim.value.claimFields[1]?.value === role &&
                    claim.value.claimFields[2]?.value === location,
            );

            if (existingClaim) {
                setVerificationStep('duplicate');
                setIsSubmitting(false);
                return;
            }

            const claim = Models.claimOccupation(organization, role, location);
            await processHandle.claim(claim);
            onCancel();
        } catch (error) {
            console.error('Failed to submit claim:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [organization, role, location, processHandle, claims, onCancel]);

    if (verificationStep === 'duplicate') {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-center">
                    You&apos;ve already made this claim
                </h2>
                <div className="flex justify-center mt-4">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        OK
                    </button>
                </div>
            </div>
        );
    }

    // Rest of existing render code...
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
    system,
}: {
    type: 'skill' | 'freeform';
    onCancel: () => void;
    system: Models.PublicKey.PublicKey;
}) => {
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [verificationStep, setVerificationStep] = useState<
        'input' | 'duplicate'
    >('input');
    const { processHandle } = useProcessHandleManager();
    const claims = useClaims(system);

    const addClaim = useCallback(async () => {
        if (!processHandle || !claims) return;
        try {
            setIsSubmitting(true);

            // Check for existing claims
            const existingClaim = claims.find((claim) => {
                const isSkill =
                    type === 'skill' &&
                    claim.value.claimType.equals(
                        Core.Models.ClaimType.ClaimTypeSkill,
                    );
                const isGeneric =
                    type === 'freeform' &&
                    claim.value.claimType.equals(
                        Core.Models.ClaimType.ClaimTypeGeneric,
                    );
                return (
                    (isSkill || isGeneric) &&
                    claim.value.claimFields[0]?.value === text
                );
            });

            if (existingClaim) {
                setVerificationStep('duplicate');
                setIsSubmitting(false);
                return;
            }

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
    }, [text, type, processHandle, claims, onCancel]);

    if (verificationStep === 'duplicate') {
        return (
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-center">
                    You&apos;ve already made this claim
                </h2>
                <div className="flex justify-center mt-4">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        OK
                    </button>
                </div>
            </div>
        );
    }

    // Original input UI
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
