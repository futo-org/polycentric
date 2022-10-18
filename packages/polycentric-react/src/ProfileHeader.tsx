import React, { useState, useEffect } from 'react';
import { Avatar, Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ImageViewer from 'react-simple-image-viewer';

import * as Core from 'polycentric-core';
import './ProfileHeader.css';
import * as ProfileUtil from './ProfileUtil';

type ProfileHeaderProps = {
    publicKey: Uint8Array;
    state: Core.DB.PolycentricState;
    fromServer?: string;
};

function ProfileHeader({ publicKey, state, fromServer }: ProfileHeaderProps) {
    const navigate = useNavigate();

    const [profile, setProfile] = useState<
        ProfileUtil.DisplayableProfile | undefined
    >(undefined);

    const [viewerLink, setViewerLink] = useState<string | undefined>(undefined);

    const handleFollow = async () => {
        await Core.DB.levelFollowUser(state, publicKey);
    };

    const handleUnfollow = async () => {
        await Core.DB.levelUnfollowUser(state, publicKey);
    };

    const loadProfile = async (
        cancelControl: Core.Util.PromiseCancelControl,
    ) => {
        const result = await ProfileUtil.loadProfileOrFallback(
            state,
            publicKey,
            [],
        );

        if (cancelControl.cancelled === false) {
            setProfile(result);
        } else {
            console.log('ProfileHeader loadProfile was cancelled');
        }
    };

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            loadProfile(cancelControl);
        };

        state.level.on('put', handlePut);

        loadProfile(cancelControl);

        return () => {
            cancelControl.cancelled = true;
            state.level.removeListener('put', handlePut);
        };
    }, [publicKey]);

    return profile ? (
        <Paper
            elevation={4}
            style={{
                marginBottom: '15px',
            }}
        >
            {fromServer !== undefined && (
                <div
                    style={{
                        paddingLeft: '5px',
                        paddingTop: '5px',
                        width: '100%',
                    }}
                >
                    Recommended By: &nbsp;
                    <span
                        style={{
                            color: 'gray',
                            fontWeight: 600,
                        }}
                    >
                        {fromServer}
                    </span>
                    <div
                        style={{
                            width: '99%',
                            marginTop: '5px',
                            marginLeft: 'auto',
                            marginRight: 'auto',
                            borderBottom: '1px solid gray',
                        }}
                    />
                </div>
            )}
            <div className="profileHeader">
                <div
                    style={{
                        display: 'flex',
                        gap: '20px',
                    }}
                >
                    <Avatar
                        src={profile.avatar}
                        onClick={() => setViewerLink(profile.avatar)}
                    />

                    {viewerLink && (
                        <ImageViewer
                            src={[viewerLink]}
                            currentIndex={0}
                            closeOnClickOutside={true}
                            onClose={() => {
                                setViewerLink(undefined);
                            }}
                            backgroundStyle={{
                                backgroundColor: 'rgba(0,0,0,0.5)',
                            }}
                        />
                    )}

                    <div className="profileHeader__headerText">
                        <h3
                            onClick={() => {
                                navigate('/' + profile.link);
                            }}
                            style={{
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {profile.displayName}
                            <span className="profileHeader__identity">
                                @{profile.identity}
                            </span>
                        </h3>
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
                    }}
                >
                    <h3
                        style={{
                            margin: '5px',
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

export default ProfileHeader;
