import * as Core from '@polycentric/polycentric-core';
import { Models } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useClaims } from '../../../hooks/queryHooks';

export type SocialPlatform =
  | 'hackerNews'
  | 'youtube'
  | 'odysee'
  | 'rumble'
  | 'twitter/X'
  | 'discord'
  | 'github'
  | 'patreon'
  | 'substack'
  | 'twitch'
  | 'website'
  | 'kick'
  | 'soundcloud'
  | 'nebula'
  | 'spotify'
  | 'polycentric'
  | 'gitlab';

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
    claimType.equals(Core.Models.ClaimType.ClaimTypeTwitter)
  );
};

const PLATFORM_TO_CLAIM_TYPE = {
  youtube: Models.ClaimType.ClaimTypeYouTube,
  'twitter/X': Core.Models.ClaimType.ClaimTypeTwitter,
  discord: Core.Models.ClaimType.ClaimTypeDiscord,
  github: Core.Models.ClaimType.ClaimTypeGitHub,
  odysee: Core.Models.ClaimType.ClaimTypeOdysee,
  rumble: Core.Models.ClaimType.ClaimTypeRumble,
  patreon: Core.Models.ClaimType.ClaimTypePatreon,
  substack: Core.Models.ClaimType.ClaimTypeSubstack,
  twitch: Core.Models.ClaimType.ClaimTypeTwitch,
  nebula: Core.Models.ClaimType.ClaimTypeNebula,
  spotify: Core.Models.ClaimType.ClaimTypeSpotify,
  kick: Core.Models.ClaimType.ClaimTypeKick,
} as const;

const PLATFORM_TO_CLAIM_FUNCTION = {
  hackerNews: Models.claimHackerNews,
  youtube: Models.claimYouTube,
  odysee: Models.claimOdysee,
  rumble: Models.claimRumble,
  github: Models.claimGitHub,
  patreon: Models.claimPatreon,
  substack: Models.claimSubstack,
  twitch: Models.claimTwitch,
  website: Models.claimWebsite,
} as const;

export const MakeClaim = ({ onClose, system }: MakeClaimProps) => {
  const [step, setStep] = useState<'type' | 'input'>('type');
  const [claimType, setClaimType] = useState<ClaimData['type'] | null>(null);
  const [platform, setPlatform] = useState<SocialPlatform | undefined>();

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

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-[9999]"
      style={{ backdropFilter: 'blur(2px)' }}
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
    </div>,
    document.body,
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
    'odysee',
    'patreon',
    'rumble',
    'soundcloud',
    'spotify',
    'twitch',
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
    'patreon',
    'substack',
  ].includes(platform);
  return result;
};

const handleOAuthLogin = async (claimType: Core.Models.ClaimType.ClaimType) => {
  try {
    // Make sure we're using the correct origin for the redirect URI
    const redirectUri = `${window.location.origin}/oauth/callback`;

    // Get the OAuth URL
    const oauthUrl = await Core.APIMethods.getOAuthURL(
      Core.APIMethods.VERIFIER_SERVER,
      claimType,
      redirectUri,
    );

    // Store the secret in localStorage for the callback
    const url = new URL(oauthUrl);
    const secret = url.searchParams.get('harborSecret') || '';
    localStorage.setItem('futoIDSecret', secret);

    // Navigate to OAuth URL
    window.location.href = oauthUrl;
  } catch (error) {
    console.error('OAuth initialization failed:', error);
    alert(
      `OAuth initialization failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
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
  const [claimPointer, setClaimPointer] =
    useState<Models.Pointer.Pointer | null>(null);
  const { processHandle } = useProcessHandleManager();
  const claims = useClaims(system);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Get the claim type for the platform
  const getClaimTypeForPlatform = useCallback(
    (platform: SocialPlatform): Core.Models.ClaimType.ClaimType => {
      const claimType =
        PLATFORM_TO_CLAIM_TYPE[platform as keyof typeof PLATFORM_TO_CLAIM_TYPE];
      if (!claimType) {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      return claimType;
    },
    [],
  );

  // Initialize OAuth on component mount
  const initializeOAuth = useCallback(async () => {
    if (!platform) return;

    try {
      const claimType = getClaimTypeForPlatform(platform);

      // Check if this platform is OAuth verifiable
      if (isOAuthVerifiable(claimType)) {
        await handleOAuthLogin(claimType);
      }
    } catch (error) {
      console.error('Failed to initialize OAuth:', error);
    }
  }, [platform, getClaimTypeForPlatform]);

  useEffect(() => {
    initializeOAuth();
  }, [initializeOAuth]);

  const addClaim = useCallback(async () => {
    if (!url || !processHandle || !claims) return;
    try {
      setIsSubmitting(true);

      // Check for existing claims first
      const claimType = getClaimTypeForPlatform(platform);
      const existingClaim = claims.find((claim) =>
        claim.value.claimType.equals(claimType),
      );

      if (existingClaim) {
        setVerificationStep('duplicate');
        setIsSubmitting(false);
        return;
      }

      // Create the claim
      const processedUrl = url.startsWith('http') ? url : `https://${url}`;
      const claimFunction =
        PLATFORM_TO_CLAIM_FUNCTION[
          platform as keyof typeof PLATFORM_TO_CLAIM_FUNCTION
        ] ?? Models.claimURL;

      const claim = claimFunction(processedUrl);

      // Create the claim normally - we'll delete it later if verification fails
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
  }, [url, platform, processHandle, claims, onCancel, getClaimTypeForPlatform]);

  const startVerification = useCallback(async () => {
    if (!processHandle || !claimPointer) return;

    setVerificationStep('verifying');

    try {
      await Core.ProcessHandle.fullSync(processHandle);

      try {
        await Core.APIMethods.requestVerification(
          claimPointer,
          getClaimTypeForPlatform(platform),
        );

        setVerificationStep('success');
        setTimeout(() => {
          onCancel();
        }, 2000);
      } catch (error) {
        console.error('Verification request failed:', error);

        // Delete the claim since verification failed
        try {
          await processHandle.delete(
            claimPointer.process,
            claimPointer.logicalClock,
          );
        } catch (deleteError) {
          console.error(
            'Failed to delete claim after verification failure:',
            deleteError,
          );
        }

        // Check for specific platform errors
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (
          platform === 'twitter/X' &&
          errorMessage.includes('temporarily unavailable')
        ) {
          setErrorMessage(
            'Twitter/X API reports this feature is temporarily unavailable. ' +
              "This is an issue with Twitter's API, not with your account. " +
              'Please try again later or try a different platform.',
          );
        } else if (
          platform === 'discord' &&
          (errorMessage.includes('access_token') ||
            errorMessage.includes('undefined'))
        ) {
          setErrorMessage(
            'Discord authentication failed. The OAuth token was not properly received. ' +
              'This may be due to Discord API changes or configuration issues. ' +
              'Please try a different platform for now.',
          );
        } else if (
          errorMessage.includes('500') ||
          errorMessage.includes('Internal server error')
        ) {
          setErrorMessage(
            `The verification server encountered an internal error while processing your ${platform} authentication. ` +
              'This is likely due to API changes or temporary issues with the platform. ' +
              'Please try again later or try a different platform.',
          );
        } else {
          setErrorMessage(errorMessage);
        }

        setVerificationStep('error');
      }
    } catch (error) {
      // Delete the claim since verification failed
      if (claimPointer) {
        try {
          await processHandle.delete(
            claimPointer.process,
            claimPointer.logicalClock,
          );
        } catch (deleteError) {
          console.error(
            'Failed to delete claim after verification failure:',
            deleteError,
          );
        }
      }

      setVerificationStep('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'An unknown error occurred with the verification server.',
      );
    }
  }, [
    processHandle,
    claimPointer,
    platform,
    onCancel,
    getClaimTypeForPlatform,
  ]);

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
          You may remove it after verification is complete. It may take a few
          minutes after updating for verification to succeed.
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
          claim.value.claimType.equals(Core.Models.ClaimType.ClaimTypeSkill);
        const isGeneric =
          type === 'freeform' &&
          claim.value.claimType.equals(Core.Models.ClaimType.ClaimTypeGeneric);
        return (
          (isSkill || isGeneric) && claim.value.claimFields[0]?.value === text
        );
      });

      if (existingClaim) {
        setVerificationStep('duplicate');
        setIsSubmitting(false);
        return;
      }

      const claim =
        type === 'skill' ? Models.claimSkill(text) : Models.claimGeneric(text);
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
