import { useEffect, useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Base64 from '@borderless/base64';
import { Button } from '@mui/material';

import ProfileHeader from './ProfileHeader';
import * as Core from 'polycentric-core';
import './Standard.css';

export const ProfilesMemo = memo(Profiles);

export type ProfilesProps = {
    setState: (state: Core.DB.PolycentricState | undefined) => void;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
};

type StateAndPublicKey = {
    publicKey: Uint8Array;
    state: Core.DB.PolycentricState;
    handleOpen: () => void;
    handleDelete: () => void;
};

function Profiles(props: ProfilesProps) {
    const navigate = useNavigate();

    const [statesAndKeys, setStatesAndKeys] = useState<
        Array<StateAndPublicKey>
    >([]);

    const handleCreateNewProfile = () => {
        navigate('/setup');
    };

    async function loadIdentities(
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> {
        if (cancelContext.cancelled()) {
            return;
        }

        const stores = await props.metaStore.listStores();

        if (cancelContext.cancelled()) {
            return;
        }

        const result: Array<StateAndPublicKey> = [];

        for (const storeInfo of stores) {
            const store = await props.metaStore.openStore(
                storeInfo.publicKey,
                storeInfo.version,
            );

            if (cancelContext.cancelled()) {
                return;
            }

            const state = new Core.DB.PolycentricState(
                store,
                props.persistenceDriver,
                'browser',
            );

            result.push({
                publicKey: storeInfo.publicKey,
                state: state,
                handleOpen: async () => {
                    await props.metaStore.setActiveStore(
                        storeInfo.publicKey,
                        storeInfo.version,
                    );

                    window.location.reload();
                },
                handleDelete: async () => {
                    await props.metaStore.deleteStore(
                        storeInfo.publicKey,
                        storeInfo.version,
                    );

                    window.location.reload();
                },
            });
        }

        if (cancelContext.cancelled()) {
            return;
        }

        setStatesAndKeys(result);
    }

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        loadIdentities(cancelContext);

        return () => {
            cancelContext.cancel();
        };
    }, [props.setState, props.persistenceDriver, props.metaStore]);

    return (
        <div className="standard_width">
            {statesAndKeys.map((item) => (
                <ProfileHeader
                    key={Base64.encode(item.publicKey)}
                    publicKey={item.publicKey}
                    state={item.state}
                    profilePageProps={{
                        onOpen: item.handleOpen,
                        onDelete: item.handleDelete,
                    }}
                />
            ))}

            <Button
                variant="contained"
                onClick={handleCreateNewProfile}
                style={{
                    width: '100%',
                    marginTop: '10px',
                }}
            >
                Create New Profile Or Important Existing Profile
            </Button>
        </div>
    );
}
