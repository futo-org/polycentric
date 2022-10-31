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
        (await Core.DB.levelLoadIdentity(state)).publicKey,
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
    console.log('PostLoader');

    const [displayable, setDisplayable] = useState<DisplayablePost | undefined>(
        props.initialPost,
    );

    const didMount = useRef<boolean>(false);

    const loadCard = async (cancelControl: Core.Util.PromiseCancelControl) => {
        if (cancelControl.cancelled) {
            return;
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const displayable = await tryLoadDisplayable(
            props.state,
            props.pointer,
            dependencyContext,
        );

        if (cancelControl.cancelled) {
            dependencyContext.cleanup();
            return;
        }

        const recurse = () => {
            dependencyContext.setHandler(
                Lodash.once(() => {
                    dependencyContext.cleanup();
                    loadCard(cancelControl);
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
        const cancelControl = {
            cancelled: false,
        };

        props.dependencyContext.setHandler(
            Lodash.once(() => {
                loadCard(cancelControl);
            }),
        );

        return () => {
            cancelControl.cancelled = true;
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

    const handleBoost = async () => {
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

    const handleDelete = Lodash.once(async () => {
        setDeleting(true);

        await Core.DB.deletePost(props.state, props.post.pointer);
    });

    const handleNavigate = (event: React.MouseEvent<HTMLDivElement>) => {
        navigate('/' + postToLink(props.post.pointer));
    };

    return (
        <Paper
            elevation={4}
            style={{
                marginBottom: '15px',
                paddingRight: '5px',
            }}
        >
            {props.post.fromServer !== undefined && (
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
                        paddingLeft: '5px',
                        paddingTop: '5px',
                        width: '100%',
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
            >
                <PostModal
                    state={props.state}
                    isOpen={modalIsOpen}
                    onClose={() => {
                        setModalIsOpen(false);
                    }}
                    boostPointer={props.post.actionPointer}
                />
                <div className="post__avatar">
                    <Avatar
                        src={props.post.profile.avatar}
                        onClick={() => {
                            setViewerLink(props.post.profile.avatar);
                        }}
                    />
                </div>
                <div className="post__main">
                    <div className="post__header">
                        <div
                            className="post__headerText"
                            style={{
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            <h3
                                onClick={() => {
                                    navigate('/' + props.post.profile.link);
                                }}
                            >
                                {props.post.profile.displayName}{' '}
                                <span
                                    style={{
                                        fontWeight: '600',
                                        fontSize: '12px',
                                        color: 'gray',
                                    }}
                                >
                                    @{props.post.profile.identity}
                                </span>
                            </h3>
                        </div>
                        <div className="post__content">
                            <div
                                style={{
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {processText(props.post.message)}
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                }}
                            >
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
                        </div>
                        {props.post.boost !== undefined && props.depth < 1 && (
                            <Post
                                state={props.state}
                                post={props.post.boost}
                                showBoost={false}
                                depth={props.depth + 1}
                            />
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
                            <p>
                                Posted on: &nbsp;
                                {new Date(
                                    props.post.unixMilliseconds,
                                ).toLocaleString()}
                            </p>
                            {/*
                            <p onClick={handleNavigate}>
                                {props.post.pointer.sequenceNumber}
                            </p>
                            */}
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
                                    onClick={() => {
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
            </div>
        </Paper>
    );
}

export default Post;
