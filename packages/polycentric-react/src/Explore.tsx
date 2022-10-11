import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import * as Search from './Search';

type ExploreProps = {
    state: Core.DB.PolycentricState;
};

function Explore(props: ExploreProps) {
    const [exploreResults, setExploreResults] = useState<
        [string, Core.Protocol.Pointer][]
    >([]);

    const handleLoad = async () => {
        const responses = await Core.DB.explore(props.state);

        for (const response of responses) {
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].resultEvents,
            );
        }

        let filteredPosts: [string, Core.Protocol.Pointer][] = [];

        for (const response of responses) {
            for (const event of response[1].resultEvents) {
                filteredPosts.push([
                    response[0],
                    {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                ]);
            }
        }

        setExploreResults(filteredPosts);
    };

    useEffect(() => {
        handleLoad();
    }, []);

    return (
        <div className="standard_width">
            {exploreResults.map((post) => {
                const raw = post[0];
                const item = post[1];

                return (
                    <Search.DispatchCard
                        key={Base64.encode(
                            Core.DB.makeStorageTypeEventKey(
                                item.publicKey,
                                item.writerId,
                                item.sequenceNumber,
                            ),
                        )}
                        state={props.state}
                        pointer={item}
                        fromServer={raw}
                    />
                );
            })}
        </div>
    );
}

export default Explore;
