import { Button, TextField, Avatar, Tooltip } from '@mui/material';
import React, { useState, useRef, useEffect } from 'react';
import * as Base64 from '@borderless/base64';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import { Paper } from '@mui/material';
import Modal from 'react-modal';
import CloseIcon from '@mui/icons-material/Close';
import Cropper, { Area } from 'react-easy-crop';
import imageCompression from 'browser-image-compression';
import * as FileSaver from 'file-saver';

import * as Core from 'polycentric-core';
import './EditProfile.css';
import './Standard.css';

type EditProfileProps = {
    state: Core.DB.PolycentricState;
};

async function renderCrop(
    image: HTMLImageElement,
    crop: Area,
): Promise<Blob | null> {
    const canvas = document.createElement('canvas');

    canvas.width = crop.width;
    canvas.height = crop.height;

    const ctx = canvas.getContext('2d');

    ctx!.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
    );

    return await new Promise((resolve) => canvas.toBlob(resolve));
}

async function createExportBundle(state: Core.DB.PolycentricState) {
    const identity = await Core.DB.levelLoadIdentity(state);

    let bundle: Core.Protocol.ExportBundle = {
        privateKey: identity.privateKey,
        events: [],
    };

    const profile = await Core.DB.loadProfile(state);

    if (profile !== undefined && profile.mutatedBy !== undefined) {
        const pointer = profile.mutatedBy;
        const potentialEvent = await state.levelEvents.get(
            Core.DB.makeStorageTypeEventKey(
                pointer.publicKey,
                pointer.writerId,
                pointer.sequenceNumber,
            ),
        );
        if (potentialEvent !== undefined) {
            const event = Core.Protocol.StorageTypeEvent.decode(potentialEvent);
            if (event.event !== undefined) {
                bundle.events.push(event.event);
            }
        }
    }

    return Core.Protocol.ExportBundle.encode(bundle).finish();
}

const customStyles = {
    content: {
        minWidth: '25%',
        minHeight: '25%',
        maxHeight: '90%',
        maxWidth: '90%',
        left: '50%',
        top: '25%',
        transform: 'translate(-50%, -25%)',
    },
};

type ImageModalProps = {
    imageLink: string;
    onUpdate: (arg0: Blob) => {};
    onCancel: () => void;
};

function ImageModal(props: ImageModalProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);

    const [area, setArea] = useState<Area | undefined>(undefined);

    const handleClose = () => {
        props.onCancel();
    };

    const handleSubmit = async () => {
        if (imageRef.current && area) {
            const blob = await renderCrop(imageRef.current, area);
            if (blob !== null) {
                const file = new File([blob], 'anonymous', {
                    type: blob.type,
                });
                const compressed = await imageCompression(file, {
                    maxSizeMB: 1,
                    useWebWorker: true,
                    maxWidthOrHeight: 256,
                });
                props.onUpdate(compressed);
            }
        }
    };

    const handleUpdateArea = (area: Area, areaPixels: Area) => {
        setArea(areaPixels);
    };

    return (
        <div>
            <img
                ref={imageRef}
                style={{
                    visibility: 'hidden',
                }}
                src={props.imageLink}
                alt="invisible"
            />
            <Modal isOpen={true} style={customStyles}>
                <CloseIcon
                    onClick={handleClose}
                    style={{
                        position: 'absolute',
                        right: '1px',
                        top: '1px',
                        zIndex: '5',
                    }}
                />

                <div
                    style={{
                        position: 'relative',
                        height: '100%',
                        width: '100%',
                        display: 'flex',
                        flexFlow: 'column',
                    }}
                >
                    <div
                        style={{
                            flex: '1',
                        }}
                    >
                        <Cropper
                            image={props.imageLink}
                            crop={crop}
                            onCropChange={setCrop}
                            zoom={zoom}
                            onZoomChange={setZoom}
                            showGrid={false}
                            aspect={1}
                            restrictPosition={true}
                            onCropAreaChange={handleUpdateArea}
                        />
                    </div>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        className="updateButton"
                    >
                        Use Crop
                    </Button>
                </div>
            </Modal>
        </div>
    );
}

function EditProfile(props: EditProfileProps) {
    const uploadRef = useRef<HTMLInputElement>(null);

    const [loading, setLoading] = useState<boolean>(true);
    const [mutated, setMutated] = useState<boolean>(false);
    const [username, setUsername] = useState<string>('');
    const [description, setDescription] = useState<string>('');

    const [avatarFile, setAvatarFile] = useState<string | undefined>(undefined);

    const [rawAvatar, setRawAvatar] = useState<Uint8Array | undefined>(
        undefined,
    );
    const [avatar, setAvatar] = useState<string | undefined>(undefined);
    const [avatarChanged, setAvatarChanged] = useState<boolean>(false);
    const [avatarPointer, setAvatarPointer] = useState<
        Core.Protocol.Pointer | undefined
    >(undefined);
    const [avatarType, setAvatarType] = useState<string | undefined>(undefined);

    const [servers, setServers] = useState<Array<string>>([]);
    const [newServer, setNewServer] = useState<string>('');
    const [writerId, setWriterId] = useState<string>('');
    const [exportState, setExportState] = useState<string>('');

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setUsername(e.target.value);
        setMutated(true);
    };

    const handleDescriptionChange = (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        setDescription(e.target.value);
        setMutated(true);
    };

    const handleImageChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        if (
            e.target !== null &&
            e.target.files !== null &&
            e.target.files.length >= 0
        ) {
            const file = e.target.files[0];
            const buffer = new Uint8Array(await file.arrayBuffer());
            setAvatarFile(Core.Util.blobToURL(file.type, buffer));

            /*
            const buffer = new Uint8Array(await file.arrayBuffer());

            setRawAvatar(buffer);
            setAvatar(Util.blobToURL(file.type, buffer));
            setAvatarChanged(true);
            setAvatarType(file.type);
            setMutated(true);
            */
        }
    };

    const onImageUpdate = async (file: Blob) => {
        const buffer = new Uint8Array(await file.arrayBuffer());

        setAvatarFile(undefined);
        setRawAvatar(buffer);
        setAvatar(Core.Util.blobToURL(file.type, buffer));
        setAvatarChanged(true);
        setAvatarType(file.type);
        setMutated(true);
    };

    const handleNewServerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewServer(e.target.value);
        setMutated(true);
    };

    const handleRemoveServer = (server: string) => {
        setServers(
            servers.filter((item) => {
                return item !== server;
            }),
        );
        setMutated(true);
    };

    const isDisplayNameValid = () => {
        const length = username.length;
        return length > 0 && length < 22;
    };

    const isNewServerValid = () => {
        if (newServer.length === 0) {
            return true;
        }

        try {
            new URL(newServer);

            return true;
        } catch (err) {
            return false;
        }
    };

    const allowNewServerSubmit = () => {
        if (newServer.length === 0) {
            return false;
        }

        return isNewServerValid();
    };

    const handleNewServerSubmit = () => {
        setNewServer('');
        setServers([...servers, newServer]);
        setMutated(true);
    };

    const isFormValid = () => {
        return isDisplayNameValid();
    };

    const handleExport = async () => {
        const blob = new Blob([exportState], {
            type: 'type/plane',
        });
        FileSaver.saveAs(blob, 'profile.polycentric');
    };

    const handleSubmit = async () => {
        console.log('updated profile', username);

        const message = Core.DB.makeDefaultEventBody();
        message.profile = {
            profileName: new TextEncoder().encode(username),
            profileDescription: new TextEncoder().encode(description),
            profileServers: [],
            profileImagePointer: avatarPointer,
        };

        for (const server of servers) {
            message.profile?.profileServers.push(
                new TextEncoder().encode(server),
            );
        }

        if (rawAvatar !== undefined && avatarChanged === true) {
            message.profile!.profileImagePointer = await Core.DB.saveBlob(
                props.state,
                avatarType!,
                rawAvatar,
            );
        }

        await Core.DB.levelSavePost(props.state, message);

        setMutated(false);
    };

    async function loadState() {
        const identity = await Core.DB.levelLoadIdentity(props.state);

        const potentialProfile = await Core.DB.tryLoadKey(
            props.state.levelProfiles,
            identity.publicKey,
        );

        if (potentialProfile !== undefined) {
            const profile =
                Core.Protocol.StorageTypeProfile.decode(potentialProfile);

            const newServers: Array<string> = [];

            for (const server of profile.servers) {
                newServers.push(new TextDecoder().decode(server));
            }

            setUsername(new TextDecoder().decode(profile.username));
            setServers(newServers);

            if (profile.description !== undefined) {
                setDescription(new TextDecoder().decode(profile.description));
            }

            if (profile.imagePointer !== undefined) {
                const dependencyContext =
                    new Core.DB.DependencyContext(props.state);

                const loaded = await Core.DB.loadBlob(
                    props.state,
                    profile.imagePointer,
                    dependencyContext,
                );

                dependencyContext.cleanup();

                if (loaded !== undefined) {
                    setRawAvatar(loaded.blob);
                    setAvatarType(loaded.kind);
                    setAvatar(Core.Util.blobToURL(loaded.kind, loaded.blob));
                }
            }

            setAvatarPointer(profile.imagePointer);
        }

        setWriterId(Base64.encodeUrl(identity.writerId));
        setExportState(Base64.encodeUrl(await createExportBundle(props.state)));
        setLoading(false);
    }

    useEffect(() => {
        loadState();
    }, []);

    if (loading) {
        return <div />;
    }

    return (
        <Paper
            elevation={4}
            className="standard_width"
            style={{
                marginTop: '15px',
            }}
        >
            <div className="editProfile">
                <div className="editProfile__top">
                    <label>
                        <Tooltip title="Upload Profile Image">
                            <Avatar
                                src={avatar}
                                onClick={() => {
                                    if (uploadRef.current) {
                                        uploadRef.current.click();
                                    }
                                }}
                            />
                        </Tooltip>
                    </label>
                    <TextField
                        label="Profile Name"
                        value={username}
                        onChange={handleUsernameChange}
                        error={!isDisplayNameValid()}
                        variant="standard"
                        className="editProfile__description"
                    />
                    <input
                        ref={uploadRef}
                        multiple={false}
                        style={{ display: 'none' }}
                        accept="image/gif, image/jpeg, image/png"
                        type="file"
                        id="contained-button-file"
                        onChange={handleImageChange}
                    />
                </div>

                <div className="editProfile__break" />

                <TextField
                    multiline
                    value={description}
                    onChange={handleDescriptionChange}
                    label="Profile Description"
                    variant="standard"
                    className="editProfile__description"
                    style={{
                        marginTop: '10px',
                    }}
                />

                <div className="editProfile__break" />

                {servers.map((server) => (
                    <div
                        key={server}
                        style={{
                            width: '100%',
                        }}
                    >
                        <div className="editProfile__serverRow">
                            <h3
                                style={{
                                    width: '100%',
                                }}
                            >
                                {server}
                            </h3>
                            <Button
                                variant="contained"
                                onClick={() => handleRemoveServer(server)}
                                color="warning"
                            >
                                <RemoveIcon />
                            </Button>
                        </div>
                    </div>
                ))}

                <div className="editProfile__break" />

                <div className="editProfile__serverRow">
                    <TextField
                        label="Server Address"
                        value={newServer}
                        onChange={handleNewServerChange}
                        error={!isNewServerValid()}
                        variant="standard"
                        style={{
                            width: '100%',
                        }}
                    />
                    <Button
                        variant="contained"
                        disabled={!allowNewServerSubmit()}
                        onClick={handleNewServerSubmit}
                    >
                        <AddIcon />
                    </Button>
                </div>

                <div className="editProfile__break" />

                <h3
                    style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                    }}
                >
                    Device Identity: {writerId}
                </h3>

                <div className="editProfile__break" />

                <div className="editProfile__top">
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={!isFormValid() || !mutated}
                        className="updateButton"
                    >
                        Update profile
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleExport}
                        className="updateButton"
                    >
                        Export Profile
                    </Button>
                </div>
            </div>
            {avatarFile !== undefined && (
                <ImageModal
                    imageLink={avatarFile}
                    onUpdate={onImageUpdate}
                    onCancel={() => {
                        setAvatarFile(undefined);
                    }}
                />
            )}
        </Paper>
    );
}

export default EditProfile;
