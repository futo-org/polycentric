import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { ObjectId } from 'bson';
import cors from 'cors';
import express from 'express';
import * as fs from 'fs';
import { StatusCodes } from 'http-status-codes';
import * as https from 'https';
import * as path from 'path';
import { platforms } from './platforms/platforms';
import { decodeObject, handleBinaryOrJson, writeResult } from './utility';
import { OAuthVerifier, TextVerifier } from './verifier';

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
    
    app.use(cors({
        origin: ['https://localhost:3000', 'https://app.polycentric.io'],
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'x-polycentric-user-agent', 'Origin', 'Accept']
    }));

    app.options('*', cors());

    // Log all requests
    app.use((req, res, next) => {
        console.log('Incoming request:', {
            method: req.method,
            url: req.url,
            headers: req.headers
        });
        next();
    });

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
            // Extract all possible OAuth parameters
            const { code, oauth_token, oauth_verifier, state } = req.query;
            let queryObject = {};
            
            // Handle different OAuth flows (Twitter uses oauth_token/oauth_verifier, Discord uses code)
            if (code) {
                queryObject = { code };
            } else if (oauth_token && oauth_verifier) {
                queryObject = { oauth_token, oauth_verifier };
            }
            
            // Extract harborSecret from state if available
            if (state) {
                try {
                    const stateObj = JSON.parse(state as string);
                    if (stateObj.harborSecret) {
                        queryObject = { ...queryObject, harborSecret: stateObj.harborSecret };
                    }
                } catch (e) {
                    console.log('Failed to parse state parameter:', e);
                }
            }

            const encodedData = Buffer.from(JSON.stringify(queryObject)).toString('base64');
            const claimType = req.params.platformName;
            
            // Use state parameters
            const webAppUrl = 'https://localhost:3000/oauth/callback';
            const redirectUrl = `${webAppUrl}?state=${encodeURIComponent(JSON.stringify({
                data: encodedData,
                claimType: claimType
            }))}`;
            res.redirect(redirectUrl);
        } catch (e: unknown) {
            console.error('OAuth callback error:', e);
            res.status(500).send('OAuth callback failed');
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

                        writeResult(res, await verifier.getToken(challengeResponse));
                    } catch (e: unknown) {
                        console.error('Token endpoint error:', e);
                        const requestId: string = new ObjectId().toString();
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
        }
    }

    // HTTPS configuration
    const httpsOptions = {
        key: fs.readFileSync(path.join(__dirname, '../certs/localhost-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '../certs/localhost.pem'))
    };

    // Create HTTPS server
    https.createServer(httpsOptions, app).listen(3002, () => {
        console.log('Verifiers server listening on HTTPS port 3002');
    });
})();
