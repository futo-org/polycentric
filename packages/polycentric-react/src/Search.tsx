import { Paper, TextField } from '@mui/material';
import { useState, useEffect } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';

type SearchProps = {
    state: Core.DB.PolycentricState;
};

function Search(props: SearchProps) {
    const params = useParams();
    const [search, setSearch] = useState<string>('');
    const [searchResult, setSearchResult] = useState<
        [Core.Protocol.Event, PostMod.DisplayablePost][]
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

        const events = await Core.DB.search(props.state, topic);

        const justEvents = events.map((x) => x[1]);
        await Core.Synchronization.saveBatch(props.state, justEvents);

        const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

        let filteredPosts: [Core.Protocol.Event, PostMod.DisplayablePost][] =
            [];

        for (const event of events) {
            const displayable = await Feed.eventToDisplayablePost(
                props.state,
                profiles,
                {
                    event: event[1],
                    mutationPointer: undefined,
                },
            );

            if (displayable !== undefined) {
                displayable.fromServer = event[0];
                filteredPosts.push([event[1], displayable]);
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
                    <Post
                        key={Base64.encode(
                            Core.DB.makeStorageTypeEventKey(
                                raw.authorPublicKey,
                                raw.writerId,
                                raw.sequenceNumber,
                            ),
                        )}
                        state={props.state}
                        post={item}
                        showBoost={true}
                        depth={0}
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
        </div>
    );
}

export default Search;
