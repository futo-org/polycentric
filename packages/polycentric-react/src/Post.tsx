import { Avatar, Button, Paper } from '@mui/material';
import LoadingButton from '@mui/lab/LoadingButton';
import { Link } from 'react-router-dom';
import React, { useState, useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReplyIcon from '@mui/icons-material/Reply';
import LoopIcon from '@mui/icons-material/Loop';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageViewer from 'react-simple-image-viewer';
import * as Base64 from '@borderless/base64';
import * as Lodash from 'lodash';
import getYouTubeID from 'get-youtube-id';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import PostModal from './PostModal';
import './Post.css';
import * as ProfileUtil from './ProfileUtil';

export type DisplayablePost = {
    pointer: Core.Protocol.Pointer;
    actionPointer: Core.Protocol.Pointer;
    profile: ProfileUtil.DisplayableProfile;
    message: string;
    image?: string;
    unixMilliseconds: number;
    sortMilliseconds: number;
    author: boolean;
    boost: DisplayablePost | undefined;
    fromServer?: string;
    boostedBy?: string;
};

type PostProps = {
    state: Core.DB.PolycentricState;
    post: DisplayablePost;
    showBoost: boolean;
    depth: number;
};

export type PostLoaderProps = {
    state: Core.DB.PolycentricState;
    pointer: Core.Protocol.Pointer;
    initialPost: DisplayablePost | undefined;
    showBoost: boolean;
    depth: number;
    dependencyContext: Core.DB.DependencyContext;
};

export async function eventToDisplayablePost(
    state: Core.DB.PolycentricState,
    profiles: Map<string, ProfileUtil.DisplayableProfile>,
    storageEvent: Core.Protocol.StorageTypeEvent,
    dependencyContext: Core.DB.DependencyContext,
): Promise<DisplayablePost | undefined> {
    if (storageEvent.mutationPointer !== undefined) {
        return undefined;
    }

    if (storageEvent.event === undefined) {
        return undefined;
    }

    const event = storageEvent.event;

    const body = Core.Protocol.EventBody.decode(event.content);

    if (body.message === undefined) {
        return undefined;
    }

    let displayableProfile = undefined;

    {
        const authorPublicKey = Base64.encodeUrl(event.authorPublicKey);
        let existing = profiles.get(authorPublicKey);

        if (existing === undefined) {
            displayableProfile = await ProfileUtil.loadProfileOrFallback(
                state,
                event.authorPublicKey,
                dependencyContext,
            );

            profiles.set(authorPublicKey, displayableProfile);
        } else {
            displayableProfile = existing;
        }
    }

    const amAuthor = Core.Util.blobsEqual(
        state.identity!.publicKey,
        event.authorPublicKey,
    );

    const pointer = {
        publicKey: event.authorPublicKey,
        writerId: event.writerId,
        sequenceNumber: event.sequenceNumber,
    };

    if (body.message.image !== undefined) {
        dependencyContext.addDependency(body.message.image);
    }

    if (body.message.boostPointer !== undefined) {
        dependencyContext.addDependency(body.message.boostPointer);
    }

    // if this is a pure boost
    if (
        body.message.message.length === 0 &&
        body.message.image === undefined &&
        body.message.boostPointer !== undefined
    ) {
        const boost = await Core.DB.tryLoadStorageEventByPointer(
            state,
            body.message.boostPointer,
        );

        // display nothing for deleted subject
        if (boost !== undefined && boost.event === undefined) {
            return undefined;
        }

        if (boost !== undefined) {
            const displayable = await eventToDisplayablePost(
                state,
                profiles,
                boost,
                dependencyContext,
            );

            if (displayable !== undefined) {
                displayable.pointer = pointer;
                displayable.boostedBy = displayableProfile.displayName;
                displayable.author = amAuthor;
                displayable.sortMilliseconds = event.unixMilliseconds;

                return displayable;
            }
        }
    }

    let displayable: DisplayablePost = {
        pointer: pointer,
        actionPointer: pointer,
        profile: displayableProfile,
        message: new TextDecoder().decode(body.message.message),
        unixMilliseconds: event.unixMilliseconds,
        sortMilliseconds: event.unixMilliseconds,
        author: amAuthor,
        boost: undefined,
    };

    if (body.message.boostPointer !== undefined) {
        const boost = await Core.DB.tryLoadStorageEventByPointer(
            state,
            body.message.boostPointer,
        );

        if (boost !== undefined) {
            displayable.boost = await eventToDisplayablePost(
                state,
                profiles,
                boost,
                dependencyContext,
            );
        }
    }

    if (body.message.image !== undefined) {
        const loaded = await Core.DB.loadBlob(
            state,
            body.message.image,
            dependencyContext,
        );

        if (loaded !== undefined) {
            displayable.image = Core.Util.blobToURL(loaded.kind, loaded.blob);
        }
    }

    return displayable;
}

export async function tryLoadDisplayable(
    state: Core.DB.PolycentricState,
    pointer: Core.Protocol.Pointer,
    dependencyContext: Core.DB.DependencyContext,
) {
    dependencyContext.addDependency(pointer);

    const event = await Core.DB.tryLoadStorageEventByPointer(state, pointer);

    if (event === undefined || event.event === undefined) {
        return undefined;
    }

    const body = Core.Protocol.EventBody.decode(event.event.content);

    const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

    const displayable = await eventToDisplayablePost(
        state,
        profiles,
        {
            event: event.event,
            mutationPointer: undefined,
        },
        dependencyContext,
    );

    return displayable;
}

export const PostLoaderMemo = memo(PostLoader);

export function PostLoader(props: PostLoaderProps) {
    const [displayable, setDisplayable] = useState<DisplayablePost | undefined>(
        props.initialPost,
    );

    const loadCard = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        if (cancelContext.cancelled()) {
            return;
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const displayable = await tryLoadDisplayable(
            props.state,
            props.pointer,
            dependencyContext,
        );

        if (cancelContext.cancelled()) {
            dependencyContext.cleanup();
            return;
        }

        const recurse = () => {
            dependencyContext.setHandler(
                Lodash.once(() => {
                    dependencyContext.cleanup();
                    loadCard(cancelContext);
                }),
            );
        };

        if (displayable !== undefined && props.initialPost !== undefined) {
            displayable.fromServer = props.initialPost.fromServer;
        }

        setDisplayable(displayable);

        recurse();
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        props.dependencyContext.setHandler(
            Lodash.once(() => {
                loadCard(cancelContext);
            }),
        );

        return () => {
            cancelContext.cancel();
        };
    }, []);

    if (displayable !== undefined) {
        return (
            <Post
                state={props.state}
                post={displayable}
                showBoost={props.showBoost}
                depth={props.depth}
            />
        );
    } else {
        return <div />;
    }
}

function processText(message: string) {
    let position = 0;
    return (
        <div>
            {message.split(/(\s+)/g).map((section: string) => {
                if (section.startsWith('#')) {
                    position++;
                    return (
                        <span key={position.toString()}>
                            <Link
                                className="hashTag"
                                to={`/search/${encodeURIComponent(section)}`}
                            >
                                {section}
                            </Link>
                            &nbsp;
                        </span>
                    );
                } else if (
                    section.startsWith('https://') ||
                    section.startsWith('http://')
                ) {
                    position++;
                    return (
                        <span key={position.toString()}>
                            <a href={section} target="_blank">
                                {section}
                            </a>
                        </span>
                    );
                } else {
                    return section;
                }
            })}
        </div>
    );
}

function postToLink(pointer: Core.Protocol.Pointer): string {
    return Base64.encodeUrl(
        Core.Protocol.URLInfo.encode({
            publicKey: pointer.publicKey,
            writerId: pointer.writerId,
            sequenceNumber: pointer.sequenceNumber,
            servers: [],
        }).finish(),
    );
}

export function Post(props: PostProps) {
    let navigate = useNavigate();

    const [viewerLink, setViewerLink] = useState<string | undefined>(undefined);
    const [modalIsOpen, setModalIsOpen] = useState(false);
    const [boosting, setBoosting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [youtubeLink, setYoutubeLink] = useState<string | undefined>(
        undefined,
    );

    const handleBoost = async (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        if (boosting === true) {
            return;
        }

        setBoosting(true);

        const event = Core.DB.makeDefaultEventBody();
        event.message = {
            message: new Uint8Array(),
            boostPointer: props.post.actionPointer,
        };

        await Core.DB.levelSavePost(props.state, event);

        setTimeout(() => {
            setBoosting(false);
        }, 500);
    };

    const handleDelete = async (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        setDeleting(true);

        await Core.DB.deletePost(props.state, props.post.pointer);
    };

    const handleNavigate = (event: React.MouseEvent<HTMLDivElement>) => {
        navigate('/' + postToLink(props.post.pointer));
    };

    const handleBackgroundClick = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        navigate('/' + postToLink(props.post.pointer));
    };

    useEffect(() => {
        props.post.message.split(/(\s+)/g).map((section: string) => {
            const parsed = getYouTubeID(section, { fuzzy: false });

            if (parsed !== null) {
                setYoutubeLink('https://www.youtube.com/embed/' + parsed);
            }
        });
    }, [props.post]);

    return (
        <Paper
            elevation={4}
            style={{
                marginBottom: '15px',
                overflow: 'auto',
            }}
        >
            {props.post.fromServer !== undefined && (
                <div
                    style={{
                        margin: '10px',
                        marginTop: '5px',
                        marginBottom: '0px',
                        fontSize: '11px',
                    }}
                >
                    Recommended By: &nbsp;
                    <span
                        style={{
                            color: 'gray',
                            fontWeight: 600,
                        }}
                    >
                        {props.post.fromServer}
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

            {props.post.boostedBy !== undefined && (
                <div
                    style={{
                        margin: '10px',
                        marginTop: '5px',
                        marginBottom: '0px',
                        fontSize: '11px',
                    }}
                >
                    Boosted By: &nbsp;
                    <span
                        style={{
                            color: 'gray',
                            fontWeight: 600,
                        }}
                    >
                        {props.post.boostedBy}
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

            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                }}
                onClick={handleBackgroundClick}
            >
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                >
                    <PostModal
                        state={props.state}
                        isOpen={modalIsOpen}
                        onClose={() => {
                            setModalIsOpen(false);
                        }}
                        boostPointer={props.post.actionPointer}
                    />
                </div>

                <Avatar
                    src={props.post.profile.avatar}
                    onClick={(e) => {
                        e.stopPropagation();
                        setViewerLink(props.post.profile.avatar);
                    }}
                    style={{
                        marginTop: '11px',
                        marginLeft: '8px',
                        marginRight: '8px',
                    }}
                />

                <div
                    style={{
                        flex: '1',
                        marginTop: '10px',
                        marginRight: '10px',
                        marginBottom: '10px',
                    }}
                >
                    <div
                        className="underline_on_hover"
                        style={{
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            fontSize: '15px',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate('/' + props.post.profile.link);
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
                            {props.post.profile.displayName}
                        </h3>
                        <span
                            style={{
                                fontWeight: '600',
                                fontSize: '11px',
                                color: 'gray',
                            }}
                        >
                            @{props.post.profile.identity}
                        </span>
                    </div>

                    <p
                        style={{
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            marginTop: '5px',
                            fontSize: '15px',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                    >
                        {processText(props.post.message)}
                    </p>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                        }}
                    >
                        {youtubeLink !== undefined && (
                            <iframe
                                src={youtubeLink}
                                frameBorder="0"
                                allow={
                                    'accelerometer; autoplay; ' +
                                    'clipboard-write; ' +
                                    'encrypted-media; ' +
                                    'gyroscope; ' +
                                    'picture-in-picture'
                                }
                                allowFullScreen
                                title="Embedded youtube"
                                style={{
                                    maxHeight: '500px',
                                    minHeight: '300px',
                                    marginTop: '10px',
                                }}
                            />
                        )}

                        <img
                            hidden={props.post.image === undefined}
                            className="post__image"
                            src={props.post.image}
                            alt="Within Post"
                            style={{
                                marginTop: '10px',
                                maxHeight: '500px',
                            }}
                            onClick={() => {
                                setViewerLink(props.post.image);
                            }}
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
                                    zIndex: 1300,
                                }}
                            />
                        )}
                    </div>

                    {props.post.boost !== undefined && props.depth < 1 && (
                        <div
                            style={{
                                marginTop: '10px',
                            }}
                        >
                            <Post
                                state={props.state}
                                post={props.post.boost}
                                showBoost={false}
                                depth={props.depth + 1}
                            />
                        </div>
                    )}

                    {props.post.boost !== undefined && props.depth >= 1 && (
                        <Paper
                            elevation={4}
                            style={{
                                textAlign: 'center',
                            }}
                        >
                            <h4
                                onClick={handleNavigate}
                                className="expandWarning"
                            >
                                Too many nested posts. Click to expand...
                            </h4>
                        </Paper>
                    )}

                    <div
                        style={{
                            fontWeight: '600',
                            fontSize: '12px',
                            color: 'gray',
                            display: 'flex',
                            justifyContent: 'space-between',
                        }}
                    >
                        <p
                            style={{
                                marginTop: '6px',
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            Posted on: &nbsp;
                            {new Date(
                                props.post.unixMilliseconds,
                            ).toLocaleString()}
                        </p>
                    </div>

                    {props.showBoost === true && (
                        <div
                            style={{
                                display: 'flex',
                                columnGap: '5px',
                            }}
                        >
                            <LoadingButton
                                loading={boosting}
                                variant="contained"
                                onClick={handleBoost}
                                loadingPosition="start"
                                startIcon={<LoopIcon />}
                                size="small"
                            >
                                Boost
                            </LoadingButton>
                            <Button
                                variant="contained"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setModalIsOpen(true);
                                }}
                                startIcon={<ReplyIcon />}
                                size="small"
                            >
                                React
                            </Button>
                            <div
                                style={{
                                    flexGrow: '1',
                                }}
                            />
                            {props.post.author && (
                                <LoadingButton
                                    loading={deleting}
                                    variant="contained"
                                    size="small"
                                    color="warning"
                                    onClick={handleDelete}
                                >
                                    <DeleteIcon />
                                </LoadingButton>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Paper>
    );
}

export default Post;
