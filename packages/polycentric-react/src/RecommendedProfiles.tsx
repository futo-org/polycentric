import { useState, useEffect } from 'react';
import * as Base64 from '@borderless/base64';

import * as Core from 'polycentric-core';
import ProfileHeader from './ProfileHeader';
import './Standard.css';

type RecommendedProfilesProps = {
    state: Core.DB.PolycentricState;
};

function RecommendedProfiles(props: RecommendedProfilesProps) {
    const [profileResult, setProfileResult] = useState<
        Array<[string, Uint8Array]>
    >([]);

    const loadProfiles = async () => {
        const events = await Core.DB.recommend_profiles(props.state);

        let filteredPosts: Array<[string, Uint8Array]> = [];

        const justEvents = events.map((x) => x[1]);
        await Core.Synchronization.saveBatch(props.state, justEvents);

        for (const event of events) {
            const body = Core.Protocol.EventBody.decode(event[1].content);
            if (body.profile !== undefined) {
                filteredPosts.push([event[0], event[1].authorPublicKey]);
            }
        }

        setProfileResult(filteredPosts);
    };

    useEffect(() => {
        loadProfiles();
    }, []);

    return (
        <div>
            {profileResult.map((row) => {
                const profileKey = row[1];
                const from = row[0];

                return (
                    <ProfileHeader
                        key={Base64.encodeUrl(profileKey)}
                        state={props.state}
                        publicKey={profileKey}
                        fromServer={from}
                    />
                );
            })}
        </div>
    );
}

export default RecommendedProfiles;
