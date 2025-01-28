import * as Core from '@polycentric/polycentric-core';
import { useEffect } from 'react';
import { handleOAuthCallback } from '../../util/oauth';

export function OAuthCallback() {
    useEffect(() => {
        const handleCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const token = params.get('token');
            const claimType = params.get('claim_type');
            const pointer = params.get('pointer');

            if (token && claimType && pointer) {
                try {
                    await handleOAuthCallback(
                        token,
                        Core.Models.ClaimType.fromNumber(parseInt(claimType)),
                        JSON.parse(pointer) as Core.Protocol.Pointer
                    );
                    window.location.href = '/';
                } catch (error) {
                    console.error('OAuth callback failed:', error);
                    window.location.href = '/';
                }
            }
        };

        handleCallback();
    }, []);

    return <div>Processing OAuth callback...</div>;
} 