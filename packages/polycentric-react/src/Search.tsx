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

type SearchProps = {
    state: Core.DB.PolycentricState;
};

type DispatchCard = {
    state: Core.DB.PolycentricState;
    pointer: Core.Protocol.Pointer;
    fromServer: string;
};

function DispatchCard(props: DispatchCard) {
    const [card, setCard] = useState<ReactNode | undefined>(undefined);

    const loadCard = async () => {
        const event = await Core.DB.tryLoadStorageEventByPointer(
            props.state,
            props.pointer,
        );

        if (event === undefined || event.event === undefined) {
            return undefined;
        }

        const body = Core.Protocol.EventBody.decode(event.event.content);

        if (body.profile !== undefined) {
            const profile = await ProfileUtil.loadProfileOrFallback(
                props.state,
                event.event.authorPublicKey,
            );

            setCard(
                <div
                    style={{
                        marginTop: '15px',
                    }}
                >
                    <ProfileHeader
                        key={Base64.encodeUrl(event.event.authorPublicKey)}
                        publicKey={event.event.authorPublicKey}
                        state={props.state}
                        fromServer={props.fromServer}
                    />
                </div>,
            );
        } else if (body.message !== undefined) {
            const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

            const displayable = await Feed.eventToDisplayablePost(
                props.state,
                profiles,
                {
                    event: event.event,
                    mutationPointer: undefined,
                },
            );

            if (displayable === undefined) {
                return undefined;
            }

            displayable.fromServer = props.fromServer;

            setCard(
                <Post
                    state={props.state}
                    post={displayable}
                    showBoost={true}
                    depth={0}
                />,
            );
        }
    };

    useEffect(() => {
        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            loadCard();
        };

        props.state.level.on('put', handlePut);

        loadCard();

        return () => {
            props.state.level.removeListener('put', handlePut);
        };
    }, [props.pointer, props.fromServer]);

    return <div>{card}</div>;
}

function Search(props: SearchProps) {
    const params = useParams();
    const [search, setSearch] = useState<string>('');
    const [searchResult, setSearchResult] = useState<
        [string, Core.Protocol.Pointer][]
    >([]);
    const [searchActive, setSearchActive] = useState<boolean>(false);
    const [submittedOnce, setSubmittedOnce] = useState<boolean>(false);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
    };

    const handleSubmitCore = async (topic: string) => {
        if (topic.length === 0) {
            return;
        }

        setSubmittedOnce(true);
        setSearchActive(true);
        setSearchResult([]);

        const responses = await Core.DB.search(props.state, topic);

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

        setSearchResult(filteredPosts);
        setSearchActive(false);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        handleSubmitCore(search);
    };

    useEffect(() => {
        if (params.search !== undefined) {
            setSearch(params.search);

            handleSubmitCore(params.search);
        }
    }, [params]);

    return (
        <div className="standard_width">
            <Paper
                elevation={4}
                style={{
                    marginTop: '15px',
                    padding: '10px',
                    display: 'flex',
                }}
            >
                <form
                    onSubmit={handleSubmit}
                    style={{
                        width: '100%',
                    }}
                >
                    <TextField
                        value={search}
                        onChange={handleSearchChange}
                        label="Search"
                        variant="standard"
                        style={{
                            width: '100%',
                        }}
                    />
                </form>
            </Paper>

            {searchResult.map((post) => {
                const raw = post[0];
                const item = post[1];

                return (
                    <DispatchCard
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

            {searchResult.length === 0 && !searchActive && submittedOnce && (
                <Paper
                    elevation={4}
                    style={{
                        marginTop: '15px',
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> Nothing was found matching this query </h3>
                </Paper>
            )}

            {searchActive && (
                <div
                    style={{
                        width: '80%',
                        marginTop: '15px',
                        marginBottom: '15px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    }}
                >
                    <LinearProgress />
                </div>
            )}
        </div>
    );
}

export default Search;
