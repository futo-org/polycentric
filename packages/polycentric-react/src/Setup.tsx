import { Button, Paper, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import * as Base64 from '@borderless/base64';

import * as Core from 'polycentric-core';
import './Standard.css';

type SetupProps = {
    state: Core.DB.PolycentricState;
};

function Setup(props: SetupProps) {
    const navigate = useNavigate();

    const handleGenerateIdentity = async () => {
        await Core.DB.newIdentity(props.state);
        await Core.DB.startIdentity(props.state);
        navigate('/profile');
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            if (e.target !== null && e.target.files !== null) {
                const file = e.target.files![0];
                const imported = await file.text();

                const bundle = Core.Protocol.ExportBundle.decode(
                    Base64.decode(imported),
                );

                if (bundle.privateKey === undefined) {
                    console.log('failed to parse bundle');
                    return;
                }

                await Core.DB.levelNewDeviceForExistingIdentity(
                    props.state,
                    bundle.privateKey,
                );

                for (const event of bundle.events) {
                    await Core.DB.levelSaveEvent(props.state, event);
                }

                await Core.DB.startIdentity(props.state);

                navigate('/');
            }
        } catch (err) {
            console.log(err);
        }
    };

    const uploadRef = useRef<HTMLInputElement>(null);

    const openUpload = () => {
        if (uploadRef.current) {
            uploadRef.current.click();
        }
    };

    return (
        <Paper
            elevation={4}
            className="standard_width"
            style={{
                marginTop: '10px',
                padding: '10px',
            }}
        >
            <h3> Welcome to Polycentric </h3>
            <p>
                Polycentric is a distributed Open-source Social Network with
                cryptographic sovereign identities. Content lives on multiple
                servers chosen by the identity owner.
            </p>
            <p>
                Your client will automatically download content from the servers
                it lives on. Data is cryptographically integrity checked to
                ensure servers are not modifying, or hiding messages from users.
                Data is offline first, allowing offline browsing, and offline
                posting.
            </p>
            <p>
                Start by creating a new identity, or importing an existing
                identity. Your browser may ask you for permission to store data
                locally. There are no usernames or passwords. You may login on a
                different device by exporting, and then importing your profile.
            </p>
            <p>
                Polycentric is currently in development. Incompatible changes
                may be made, and your profile may not be usable forever. For
                more information checkout our &nbsp;
                <a
                    target="_blank"
                    href="https://gitlab.futo.org/harpo/polycentric/-/blob/master/README.md"
                >
                    GitLab repo
                </a>
                .
            </p>
            <div
                style={{
                    display: 'flex',
                    columnGap: '5px',
                }}
            >
                <Button variant="contained" onClick={handleGenerateIdentity}>
                    Generate New Profile
                </Button>
                <Button variant="contained" onClick={openUpload}>
                    Import Existing Profile
                </Button>
                <input
                    ref={uploadRef}
                    style={{ display: 'none' }}
                    accept=".polycentric"
                    type="file"
                    id="contained-button-file"
                    onChange={handleUpload}
                />
            </div>
        </Paper>
    );
}

export default Setup;
