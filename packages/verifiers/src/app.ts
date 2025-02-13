import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { handleBinaryOrJson, writeResult, decodeObject } from './utility';
import express from 'express';
import { OAuthVerifier, TextVerifier } from './verifier';
import { StatusCodes } from 'http-status-codes';
import { platforms } from './platforms/platforms';
import { ObjectId } from 'bson';

import * as Core from '@polycentric/polycentric-core';
import * as LevelDB from '@polycentric/polycentric-leveldb';

async function loadProcessHandle(): Promise<Core.ProcessHandle.ProcessHandle> {
    const persistenceDriver = LevelDB.createPersistenceDriverLevelDB('./state');
    const metaStore = await Core.MetaStore.createMetaStore(persistenceDriver);
    const activeStore = await metaStore.getActiveStore();

    if (activeStore) {
        console.log('Loading existing system');
        const level = await metaStore.openStore(activeStore.system, activeStore.version);
        const store = new Core.Store.Store(level);
        const handle = await Core.ProcessHandle.ProcessHandle.load(store);
        return handle;
    } else {
        console.log('Generating new system');
        const handle = await Core.ProcessHandle.createProcessHandle(metaStore);
        await handle.addServer('https://srv1-stg.polycentric.io');
        await metaStore.setActiveStore(handle.system(), 0);
        return handle;
    }
}

(async () => {
    const handle = await loadProcessHandle();
    console.log(`System loaded (keyType: ${handle.system().keyType}, key: ${Buffer.from(handle.system().key).toString('base64')})`);

    const app = express();
    app.use(express.json());

    const port = 3002;
    app.get('/platforms', (req, res) => {
        try {
            res.json(
                platforms.map((platform) => {
                    return { name: platform.name };
                })
            ).status(200);
        } catch (e: unknown) {
            const requestId: string = new ObjectId().toString();
            console.error(`[500 ERROR] (${requestId}) GET /platforms \n${String(e)}`);
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                message: `An unknown error has occurred (Request Id: ${requestId})`,
                extendedMessage: 'Internal server error while getting list of platforms',
            });
        }
    });

    app.get('/platforms/:platformName/oauth/callback', (req, res) => {
        try {
            const { redirectUri: _, ...queryWithoutRedirect } = req.query;
            const queryObject = JSON.stringify(queryWithoutRedirect);
            const encodedData = encodeURIComponent(Buffer.from(queryObject).toString('base64'));
            const redirectUri = (req.query.redirectUri as string) || `harborsocial://${req.params.platformName}`;

            res.redirect(`${redirectUri}?oauthData=${encodedData}`);
        } catch (e: unknown) {
            const requestId: string = new ObjectId().toString();
            console.error(`[500 ERROR] (${requestId}) GET /platforms/${req.params.platformName}/oauth/callback \n${String(e)}`);
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                message: `An unknown error has occurred (Request Id: ${requestId})`,
                extendedMessage: 'Internal server error while processing OAuth callback',
            });
        }
    });

    for (const platform of platforms) {
        app.get(`/platforms/${platform.name}`, (req, res) => {
            try {
                res.json(
                    platform.verifiers.map((verifier) => {
                        return {
                            verifierType: verifier.verifierType,
                            claimType: verifier.claimType.toInt(),
                        };
                    })
                ).status(200);
            } catch (e: unknown) {
                const requestId: string = new ObjectId().toString();
                console.error(`[500 ERROR] (${requestId}) GET /platforms/${platform.name} \n${String(e)}`);
                res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                    message: `An unknown error has occurred (Request Id: ${requestId})`,
                    extendedMessage: 'Internal server error while fetching platforms',
                });
            }
        });

        for (const verifier of platform.verifiers) {
            const name = verifier.claimType.toInt().toString();
            await verifier.init();

            app.post(`/platforms/${name}/${verifier.verifierType}/vouch`, handleBinaryOrJson, async (req, res) => {
                try {
                    const vouchResult = await verifier.requestVouch(handle, req);

                    const contentType = req.headers['content-type'];
                    if (vouchResult.success) {
                        if (contentType === 'application/octet-stream') {
                            const responseBuffer = Buffer.from(Core.Protocol.Pointer.encode(vouchResult.value).finish());
                            res.setHeader('Content-Type', 'application/octet-stream');
                            res.status(StatusCodes.OK).send(responseBuffer);
                        } else {
                            res.status(StatusCodes.OK).json(Core.Protocol.Pointer.toJSON(vouchResult.value));
                        }
                    } else {
                        res.status(vouchResult.error.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR).json({
                            message: vouchResult.error.message,
                            extendedMessage: vouchResult.error.extendedMessage,
                        });
                    }
                } catch (e: unknown) {
                    const requestId: string = new ObjectId().toString();
                    console.error(`[500 ERROR] (${requestId}) POST /platforms/${name}/${verifier.verifierType}/vouch \n${String(e)}`);
                    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                        message: `An unknown error has occurred (Request Id: ${requestId})`,
                        extendedMessage: 'Internal server error while handling vouch',
                    });
                }
            });

            if (verifier instanceof OAuthVerifier) {
                app.get(`/platforms/${name}/${verifier.verifierType}/url`, async (req, res) => {
                    try {
                        writeResult(res, await verifier.getOAuthURL());
                    } catch (e: unknown) {
                        const requestId: string = new ObjectId().toString();
                        console.error(`[500 ERROR] (${requestId}) GET /platforms/${name}/${verifier.verifierType}/url \n${String(e)}`);
                        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                            message: `An unknown error has occurred (Request Id: ${requestId})`,
                            extendedMessage: 'Internal server error while fetching OAuth URL',
                        });
                    }
                });

                app.get(`/platforms/${name}/${verifier.verifierType}/token`, async (req, res) => {
                    try {
                        const challenge = req.query.oauthData as string;
                        const challengeResponse = decodeObject<any>(challenge);

                        if (req.query.harborSecret !== undefined && req.query.harborSecret !== '') {
                            challengeResponse.harborSecret = req.query.harborSecret;
                        }

                        writeResult(res, await verifier.getToken(challengeResponse));
                    } catch (e: unknown) {
                        const requestId: string = new ObjectId().toString();
                        console.error(`[500 ERROR] (${requestId}) GET /platforms/${name}/${verifier.verifierType}/token \n${String(e)}`);
                        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                            message: `An unknown error has occurred (Request Id: ${requestId})`,
                            extendedMessage: 'Internal server error while processing OAuth token',
                        });
                    }
                });
            }

            if (verifier instanceof TextVerifier) {
                app.post(`/platforms/${name}/${verifier.verifierType}/getClaimFieldsByUrl`, async (req, res) => {
                    try {
                        return writeResult(res, await verifier.getClaimFieldsByUrl(req.body.url));
                    } catch (e: unknown) {
                        const requestId: string = new ObjectId().toString();
                        console.error(
                            `[500 ERROR] (${requestId}) POST /platforms/${name}/${verifier.verifierType}/getClaimFieldsByUrl \n${String(e)}`
                        );
                        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                            message: `An unknown error has occurred (Request Id: ${requestId})`,
                            extendedMessage: 'Internal server error while fetching claim fields',
                        });
                    }
                });
            }

            app.get(`/platforms/${name}/${verifier.verifierType}/healthCheck`, async (req, res) => {
                try {
                    return writeResult(res, await verifier.healthCheck());
                } catch (e: unknown) {
                    const requestId: string = new ObjectId().toString();
                    console.error(`[500 ERROR] (${requestId}) GET /platforms/${name}/${verifier.verifierType}/healthCheck \n${String(e)}`);
                    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                        message: `An unknown error has occurred (Request Id: ${requestId})`,
                        extendedMessage: 'Internal server error while processing health checks',
                    });
                }
            });

            console.log(
                `Initialized verifier with type '${verifier.verifierType}' for platform '${name}' (${Core.Models.ClaimType.toString(
                    verifier.claimType
                )}).`
            );
        }
    }

    app.listen(port, () => {
        console.log(`Verifiers server listening on port ${port}`);
    });
})();
