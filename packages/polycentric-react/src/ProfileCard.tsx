import React, { useState, useEffect } from 'react';
import { Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import * as Core from 'polycentric-core';
import './ProfileHeader.css';
import * as ProfileUtil from './ProfileUtil';

type ProfileHeaderProps = {
    publicKey: Uint8Array;
    state: Core.DB.PolycentricState;
};

function ProfileCard({ publicKey, state }: ProfileHeaderProps) {
    const navigate = useNavigate();

    const [profile, setProfile] = useState<
        ProfileUtil.DisplayableProfile | undefined
    >(undefined);

    const handleFollow = async () => {
        await Core.DB.levelFollowUser(state, publicKey);
    };

    const handleUnfollow = async () => {
        await Core.DB.levelUnfollowUser(state, publicKey);
    };

    const loadProfile = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        const dependencyContext = new Core.DB.DependencyContext(state);

        const result = await ProfileUtil.loadProfileOrFallback(
            state,
            publicKey,
            dependencyContext,
        );

        dependencyContext.cleanup();

        if (cancelContext.cancelled()) {
            return;
        }

        setProfile(result);
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            loadProfile(cancelContext);
        };

        state.levelEvents.on('put', handlePut);

        loadProfile(cancelContext);

        return () => {
            cancelContext.cancel();
            state.levelEvents.removeListener('put', handlePut);
        };
    }, [publicKey]);

    return profile ? (
        <Paper
            elevation={4}
            style={{
                overflow: 'hidden',
                marginBottom: '15px',
            }}
        >
            <img
                src={profile.avatar}
                style={{
                    width: '100%',
                }}
            />

            <div className="profileHeader">
                <div
                    style={{
                        display: 'flex',
                        gap: '20px',
                    }}
                >
                    <div
                        className="profileHeader__headerText"
                        onClick={() => {
                            navigate('/' + profile.link);
                        }}
                    >
                        <h3
                            style={{
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                marginTop: '0px',
                                marginBottom: '0px',
                            }}
                        >
                            {profile.displayName}
                       </h3>
                        <span className="profileHeader__identity">
                            @{profile.identity}
                        </span>
                    </div>
                </div>
                <h3
                    style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {profile.description}
                </h3>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '5px',
                    }}
                >
                    <h3
                        style={{
                            marginTop: '0px',
                            marginBottom: '0px',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        Downloaded: {profile.status}
                    </h3>
                    {profile.following ? (
                        <Button
                            variant="contained"
                            onClick={handleUnfollow}
                            color="warning"
                            size="small"
                        >
                            Unfollow
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            onClick={handleFollow}
                            size="small"
                            disabled={!profile.allowFollow}
                        >
                            Follow
                        </Button>
                    )}
                </div>
            </div>
        </Paper>
    ) : (
        <div />
    );
}

export default ProfileCard;
