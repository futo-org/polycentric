import { Button, Paper, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import * as Base64 from '@borderless/base64';
import * as Ed from '@noble/ed25519';

import * as Core from 'polycentric-core';
import './Standard.css';

type SetupCreateProfileProps = {
    setState: (state: Core.DB.PolycentricState | undefined) => void;
    onBack: () => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
};

function SetupCreateProfile(props: SetupCreateProfileProps) {
    const navigate = useNavigate();

    const [page, setPage] = useState<number>(0);
    const [profileName, setProfileName] = useState<string>('');

    const nextState = useRef<Core.DB.PolycentricState | undefined>(undefined);

    const isProfileNameValid = () => {
        const length = profileName.length;
        return length > 0 && length < 22;
    };

    const handleProfileNameChange = (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        setProfileName(e.target.value);
    };

    const handleSaveIdentity = async () => {
        let persisted = false;

        try {
            persisted = await navigator.storage.persist();
        } catch (err) {
            console.log(err);
        }

        const state = await Core.DB.createStateNewIdentity(
            props.metaStore,
            props.persistenceDriver,
            profileName,
        );

        await Core.DB.startIdentity(state);

        await props.metaStore.setStoreReady(
            state.identity!.publicKey,
            Core.DB.STORAGE_VERSION,
        );

        await props.metaStore.setActiveStore(
            state.identity!.publicKey,
            Core.DB.STORAGE_VERSION,
        );

        if (persisted === true) {
            console.log('navigating');

            props.setState(state);

            navigate('/explore');
        } else {
            console.log('other page');
            nextState.current = state;
            setPage(1);
        }
    };

    const handleContinue = () => {
        props.setState(nextState.current);
        navigate('/explore');
    };

    if (page === 0) {
        return (
            <Paper
                elevation={4}
                className="standard_width"
                style={{
                    marginTop: '10px',
                    padding: '10px',
                }}
            >
                <h3> What do you want to be called? </h3>

                <TextField
                    label="Profile Name"
                    value={profileName}
                    onChange={handleProfileNameChange}
                    variant="standard"
                    error={!isProfileNameValid()}
                    style={{
                        width: '100%',
                        marginBottom: '25px',
                    }}
                />

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                    <Button variant="contained" onClick={props.onBack}>
                        Back
                    </Button>
                    <Button
                        variant="contained"
                        disabled={!isProfileNameValid()}
                        onClick={handleSaveIdentity}
                    >
                        Create
                    </Button>
                </div>
            </Paper>
        );
    } else {
        return (
            <Paper
                elevation={4}
                className="standard_width"
                style={{
                    marginTop: '10px',
                    padding: '10px',
                }}
            >
                <h3> It looks like your profile may not be persisted </h3>

                <p>
                    If you are using Chrome you may need to bookmark Polycentric
                    for the browser to allow persistence.
                </p>

                <p>
                    This could be because you are using incognito mode. If you
                    are using incognito mode please use a normal tab.
                </p>

                <p>
                    If you are using Firefox you may have denied Polycentric the
                    ability to store data. If so please update your permissions
                    to enable persistent storage.
                </p>

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                    <div />
                    <Button
                        variant="contained"
                        onClick={handleContinue}
                        style={{
                            width: '100%',
                            marginTop: '10px',
                        }}
                    >
                        Continue at risk of losing your profile.
                    </Button>
                </div>
            </Paper>
        );
    }
}

type SetupLandingProps = {
    onCreateProfile: () => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
    setState: (state: Core.DB.PolycentricState | undefined) => void;
};

function SetupLanding(props: SetupLandingProps) {
    const navigate = useNavigate();

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

                const state = await Core.DB.createStateExtendIdentity(
                    props.metaStore,
                    props.persistenceDriver,
                    bundle.privateKey,
                );

                for (const event of bundle.events) {
                    await Core.Ingest.levelSaveEvent(state, event);
                }

                await Core.DB.startIdentity(state);

                await props.metaStore.setStoreReady(
                    state.identity!.publicKey,
                    Core.DB.STORAGE_VERSION,
                );

                await props.metaStore.setActiveStore(
                    state.identity!.publicKey,
                    Core.DB.STORAGE_VERSION,
                );

                props.setState(state);

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
                <Button variant="contained" onClick={props.onCreateProfile}>
                    Create New Profile
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

type SetupProps = {
    setState: (state: Core.DB.PolycentricState | undefined) => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
};

function Setup(props: SetupProps) {
    const [page, setPage] = useState<number>(0);

    const handleBack = () => {
        setPage(0);
    };

    const handleCreateProfile = () => {
        setPage(1);
    };

    if (page === 1) {
        return (
            <SetupCreateProfile
                onBack={handleBack}
                persistenceDriver={props.persistenceDriver}
                metaStore={props.metaStore}
                setState={props.setState}
            />
        );
    } else {
        return (
            <SetupLanding
                onCreateProfile={handleCreateProfile}
                persistenceDriver={props.persistenceDriver}
                metaStore={props.metaStore}
                setState={props.setState}
            />
        );
    }
}

export default Setup;
