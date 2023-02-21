import React, { useState, useEffect, useRef } from 'react';
import Modal from 'react-modal';
import { Button, TextField } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import imageCompression from 'browser-image-compression';

import * as Core from 'polycentric-core';

const customStyles = {
    content: {
        top: '20%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        minWidth: '25%',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
    },
    overlay: {
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1300,
    },
};

type PostModalProps = {
    state: Core.DB.PolycentricState;
    isOpen: boolean;
    onClose: () => void;
    boostPointer?: Core.Protocol.Pointer;
};

function PostModal(props: PostModalProps) {
    const [mutated, setMutated] = useState<boolean>(false);
    const [allowSubmit, setAllowSubmit] = useState<boolean>(false);
    const [message, setMessage] = useState<string>('');
    const [image, setImage] = useState<Uint8Array | undefined>(undefined);
    const [imageName, setImageName] = useState<string | undefined>(undefined);
    const [imageType, setImageType] = useState<string | undefined>(undefined);

    const handleClose = () => {
        setMutated(false);
        setAllowSubmit(false);
        setMessage('');
        setImage(undefined);
        setImageName(undefined);
        setImageType(undefined);
        props.onClose();
    };

    const handleSubmit = async () => {
        const event = Core.DB.makeDefaultEventBody();
        event.message = {
            message: new TextEncoder().encode(message),
            boostPointer: props.boostPointer,
        };

        if (image !== undefined) {
            event.message.image = await Core.DB.saveBlob(
                props.state,
                imageType!,
                image,
            );
        }

        await Core.DB.levelSavePost(props.state, event);

        handleClose();
    };

    const handleUpdateMessage = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMessage(e.target.value);
        setMutated(true);
    };

    const uploadRef = useRef<HTMLInputElement>(null);

    const openUpload = () => {
        if (uploadRef.current) {
            uploadRef.current.click();
        }
    };

    const handleImageChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        if (e.target !== null && e.target.files !== null) {
            const file = e.target.files![0];

            // const buffer = new Uint8Array(await file.arrayBuffer());

            console.info(`File size ${file.size / 1024 / 1024} MB`);

            const compressed = await imageCompression(file, {
                maxSizeMB: 1,
                useWebWorker: true,
                maxWidthOrHeight: 1920,
            });

            console.info(
                `Compressed file size ${compressed.size / 1024 / 1024} MB`,
            );

            const buffer = new Uint8Array(await compressed.arrayBuffer());

            setImage(buffer);
            setImageType(file.type);
            setMutated(true);
            setImageName(e.target.files![0].name);
        }
    };

    useEffect(() => {
        if (mutated === false) {
            setAllowSubmit(false);
        } else if (
            (message.length === 0 || message.length > 280) &&
            image === undefined
        ) {
            setAllowSubmit(false);
        } else {
            setAllowSubmit(true);
        }
    }, [mutated, message, image]);

    return (
        <Modal isOpen={props.isOpen} style={customStyles}>
            <CloseIcon
                onClick={handleClose}
                style={{
                    position: 'absolute',
                    right: '5px',
                    top: '5px',
                }}
            />

            <div>
                <TextField
                    multiline
                    variant="standard"
                    placeholder="What's on your mind?"
                    minRows={3}
                    maxRows={10}
                    style={{ width: '100%' }}
                    value={message}
                    onChange={handleUpdateMessage}
                />
            </div>
            <p hidden={imageName === undefined}>Attachment: {imageName}</p>
            <div
                style={{
                    marginTop: '10px',
                    display: 'flex',
                    columnGap: '5px',
                }}
            >
                <input
                    ref={uploadRef}
                    style={{ display: 'none' }}
                    accept="image/gif, image/jpeg, image/png"
                    type="file"
                    id="contained-button-file"
                    onChange={handleImageChange}
                />
                <Button variant="contained" onClick={openUpload}>
                    <AttachFileIcon />
                </Button>
                <div style={{ flexGrow: 1 }}></div>
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: 'gray',
                        paddingRight: '5px',
                    }}
                >
                    {280 - message.length}
                </span>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={!allowSubmit}
                >
                    Post
                </Button>
            </div>
        </Modal>
    );
}

export default PostModal;
