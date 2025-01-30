import * as Core from '@polycentric/polycentric-core';
import Long from 'long';
import { useEffect } from 'react';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { handleOAuthCallback, getOAuthUsername } from '../../util/oauth';

export function OAuthCallback() {
    const { processHandle } = useProcessHandleManager();

    useEffect(() => {
        const handleCallback = async () => {
            if (!processHandle) return;

            const params = new URLSearchParams(window.location.search);
            const token = params.get('token');
            const claimType = params.get('claim_type');

            if (!token || !claimType) {
                console.error('Missing OAuth parameters');
                window.location.href = '/';
                return;
            }

            try {
                // Create claim after OAuth success
                let claim: Core.Protocol.Claim;
                const claimTypeNum = new Long(parseInt(claimType), 0, true) as Core.Models.ClaimType.ClaimType;
                
                // Get username from OAuth response
                const oauthResponse = await getOAuthUsername(token, claimTypeNum);
                
                // Create appropriate claim based on type
                switch (claimTypeNum.toString()) {
                    case Core.Models.ClaimType.ClaimTypeTwitter.toString():
                        claim = Core.Models.claimTwitter(oauthResponse.username);
                        break;
                    case Core.Models.ClaimType.ClaimTypeDiscord.toString():
                        claim = Core.Models.claimDiscord(oauthResponse.username);
                        break;
                    case Core.Models.ClaimType.ClaimTypeInstagram.toString():
                        claim = Core.Models.claimInstagram(oauthResponse.username);
                        break;
                    default:
                        throw new Error('Unsupported claim type');
                }

                // Create the claim
                const pointer = await processHandle.claim(claim);
                
                // Request verification with OAuth token
                await handleOAuthCallback(token, claimTypeNum, pointer);
                
                window.location.href = '/';
            } catch (error) {
                console.error('OAuth callback failed:', error);
                window.location.href = '/';
            }
        };

        handleCallback();
    }, [processHandle]);

    return <div>Processing OAuth callback...</div>;
} 