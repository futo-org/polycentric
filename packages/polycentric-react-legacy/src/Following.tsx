import React, { useState, useEffect, useCallback } from 'react';
import * as Base64 from '@borderless/base64';
import { Paper } from '@mui/material';

import * as Core from '@polycentric/polycentric-core';
import ProfileHeader from './ProfileHeader';
import './Standard.css';

type FollowingProps = {
    state: Core.DB.PolycentricState;
};

function Following(props: FollowingProps) {
    const [loaded, setLoaded] = useState<boolean>(false);
    const [following, setFollowing] = useState<Array<Uint8Array>>([]);

    async function updateFollowing(
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> {
        const amFollowing = await Core.DB.levelLoadFollowing(props.state);

        if (cancelContext.cancelled()) {
            return;
        }

        setFollowing(amFollowing);
        setLoaded(true);
    }

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setLoaded(false);

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            updateFollowing(cancelContext);
        };

        props.state.levelFollowing.on('put', handlePut);

        updateFollowing(cancelContext);

        return () => {
            cancelContext.cancel();
            props.state.levelFollowing.removeListener('put', handlePut);
        };
    }, []);

    return (
        <div className="standard_width">
            {following?.map((following) => (
                <ProfileHeader
                    key={Base64.encodeUrl(following)}
                    publicKey={following}
                    state={props.state}
                    profilePageProps={undefined}
                />
            ))}
            {loaded && following.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        marginTop: '15px',
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> You don't appear to be following anyone </h3>
                </Paper>
            )}
        </div>
    );
}

export default Following;
