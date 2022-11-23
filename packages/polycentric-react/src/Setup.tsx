import { Button, Paper, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import * as Base64 from '@borderless/base64';
import * as Ed from '@noble/ed25519';
import browser from 'browser-detect';

import * as Core from 'polycentric-core';
import './Standard.css';

type PersistencePageProps = {
    handleStart: () => Promise<void>;
};

function PersistencePage(props: PersistencePageProps) {
    const [page, setPage] = useState<number>(0);

    async function checkPermissions() {
        const persisted = await navigator.storage.persist();

        if (persisted === true) {
            await props.handleStart();
        }
    }

    async function askPermission() {
        const browserInfo = browser();

        let persisted = false;

        if (browserInfo.name === 'chrome') {
            const verdict = await Notification.requestPermission();

            if (verdict === 'granted') {
                persisted = true;
            }

            persisted = await navigator.storage.persist();
        } else {
            persisted = await navigator.storage.persist();
        }

        if (persisted === true) {
            await props.handleStart();
        } else {
            setPage(1)
        }
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
                <h3>
                    It looks like persistence is not enabled in your browser.
                </h3>

                <p>
                    Polycentric needs persistence in order to save 
                    your identity.
                </p>

                <p>
                    On Chrome notifications are required for persistence.
                </p>

                <Button
                    variant="contained"
                    onClick={askPermission}
                    style={{
                        width: '100%',
                        marginTop: '10px',
                    }}
                >
                    Ask for permission
                </Button>
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
                <h3>
                    It looks like persistence was not enabled.
                </h3>

                <p>
                    Polycentric needs persistence in order to save your
                    identity.
                </p>

                <Button
                    variant="contained"
                    onClick={checkPermissions}
                    style={{
                        width: '100%',
                        marginTop: '10px',
                    }}
                >
                    I updated my permissions
                </Button>
            </Paper>
        );
    }
}

type SetupCreateProfileProps = {
    handleStart: (cb: () => Promise<Core.DB.PolycentricState>) => void;
    onBack: () => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
};

function SetupCreateProfile(props: SetupCreateProfileProps) {
    const navigate = useNavigate();

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
        // console.log(await Notification.requestPermission());

        const start = async () => {
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

            return state;
        };

        props.handleStart(start);
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
}

type SetupLandingProps = {
    handleStart: (cb: () => Promise<Core.DB.PolycentricState>) => void;
    onCreateProfile: () => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
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

                const start = async () => {
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

                    return state;
                };

                props.handleStart(start);
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

    const link =
        "https://gitlab.futo.org/harpo/polycentric/-/blob/master/README.md";

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
                    href={link}
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
    const navigate = useNavigate();
    const [page, setPage] = useState<number>(0);

    const [setupCB, setSetupCB] = useState<
        (() => Promise<void>) | undefined
    >(undefined);

    const handleBack = () => {
        setPage(0);
    };

    const handleCreateProfile = () => {
        setPage(1);
    };

    const handleStart = async (
        setup: () => Promise<Core.DB.PolycentricState>
    ) => {
        const persisted = await props.persistenceDriver.persisted();

        async function runSetup() {
            const state = await setup();

            props.setState(state);

            navigate('/explore');
        };

        if (persisted === true) {
            await runSetup();
        } else {
            setSetupCB(() => {
                return runSetup;
            });
        }
    };

    if (setupCB !== undefined) {
            console.log('was persisted5');
        return (
            <PersistencePage
                handleStart={setupCB}
            />
        );
    } else if (page === 1) {
        return (
            <SetupCreateProfile
                handleStart={handleStart}
                onBack={handleBack}
                persistenceDriver={props.persistenceDriver}
                metaStore={props.metaStore}
            />
        );
    } else {
        return (
            <SetupLanding
                handleStart={handleStart}
                onCreateProfile={handleCreateProfile}
                persistenceDriver={props.persistenceDriver}
                metaStore={props.metaStore}
            />
        );
    }
}

export default Setup;
