import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { ObjectId } from 'bson';
import cors from 'cors';
import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { platforms } from './platforms/platforms';
import { decodeObject, handleBinaryOrJson, writeResult } from './utility';
import { OAuthVerifier, TextVerifier } from './verifier';

import * as Core from '@polycentric/polycentric-core';
import * as LevelDB from '@polycentric/polycentric-leveldb';

const oauthSecrets = new Map<
  string,
  { secret: string; timeoutId: NodeJS.Timeout }
>();
const OAUTH_SECRET_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function storeOAuthSecret(token: string, secret: string) {
  clearTimeout(oauthSecrets.get(token)?.timeoutId);
  const timeoutId = setTimeout(() => {
    oauthSecrets.delete(token);
  }, OAUTH_SECRET_TIMEOUT_MS);
  oauthSecrets.set(token, { secret, timeoutId });
}

function retrieveOAuthSecret(token: string): string | undefined {
  const entry = oauthSecrets.get(token);
  if (entry) {
    clearTimeout(entry.timeoutId);
    oauthSecrets.delete(token);
    return entry.secret;
  }
  return undefined;
}

async function loadProcessHandle(): Promise<Core.ProcessHandle.ProcessHandle> {
  const persistenceDriver = LevelDB.createPersistenceDriverLevelDB('./state');
  const metaStore = await Core.MetaStore.createMetaStore(persistenceDriver);
  const activeStore = await metaStore.getActiveStore();

  if (activeStore) {
    console.log('Loading existing system');
    const level = await metaStore.openStore(
      activeStore.system,
      activeStore.version,
    );
    const store = new Core.Store.Store(level);
    const handle = await Core.ProcessHandle.ProcessHandle.load(store);
    return handle;
  } else {
    const handle = await Core.ProcessHandle.createProcessHandle(metaStore);
    const serverUrl =
      process.env.SERVER_URL || 'https://staging-serv1.polycentric.io/';
    await handle.addServer(serverUrl);
    await metaStore.setActiveStore(handle.system(), 0);
    return handle;
  }
}

(async () => {
  const handle = await loadProcessHandle();
  console.log(
    `System loaded (keyType: ${handle.system().keyType}, key: ${Buffer.from(
      handle.system().key,
    ).toString('base64')})`,
  );

  const app = express();
  app.use(express.json());

  app.use(
    cors({
      origin: (
        process.env.ALLOWED_ORIGINS ||
        'https://localhost:3000,http://localhost:3000,https://app.polycentric.io,https://staging-web.polycentric.io,https://web.polycentric.io,https://polycentric.io'
      ).split(','),
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'x-polycentric-user-agent',
        'Origin',
        'Accept',
      ],
    }),
  );

  // Log all requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming request:`, {
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    next();
  });

  app.get('/platforms', (req, res) => {
    try {
      res
        .json(
          platforms.map((platform) => {
            return { name: platform.name };
          }),
        )
        .status(200);
    } catch (e: unknown) {
      const requestId: string = new ObjectId().toString();
      console.error(`[500 ERROR] (${requestId}) GET /platforms \n${String(e)}`);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        message: `An unknown error has occurred (Request Id: ${requestId})`,
        extendedMessage:
          'Internal server error while getting list of platforms',
      });
    }
  });

  app.get('/platforms/:platformName/oauth/callback', (req, res) => {
    try {
      const { code, oauth_token, oauth_verifier, state } = req.query;
      let queryObject: Record<string, any> = {};
      const platformIdentifier = req.params.platformName;

      if (
        oauth_token &&
        typeof oauth_token === 'string' &&
        oauth_verifier &&
        typeof oauth_verifier === 'string'
      ) {
        const secret = retrieveOAuthSecret(oauth_token);
        if (!secret) {
          console.error(
            `OAuth secret not found or expired for token: ${oauth_token}`,
          );
          res
            .status(StatusCodes.BAD_REQUEST)
            .send('OAuth session expired or invalid.');
          return;
        }
        queryObject = {
          oauth_token: oauth_token,
          oauth_verifier: oauth_verifier,
          secret: secret,
        };
      } else if (code && typeof code === 'string') {
        queryObject = { code };
        if (state && typeof state === 'string') {
          queryObject.state = state;
        }
      } else {
        res
          .status(StatusCodes.BAD_REQUEST)
          .send('Missing required OAuth parameters in callback.');
        return;
      }

      const encodedData = Buffer.from(JSON.stringify(queryObject)).toString(
        'base64',
      );

      const redirectState = JSON.stringify({
        data: encodedData,
        claimType: platformIdentifier,
      });

      const redirectUrlObject = new URL(
        decodeURIComponent(JSON.parse(state as string).redirectUri),
      );
      redirectUrlObject.searchParams.set('state', redirectState);
      res.redirect(redirectUrlObject.href);
    } catch (e: unknown) {
      const requestId: string = new ObjectId().toString();
      console.error(
        `[500 ERROR] (${requestId}) GET /platforms/:platformName/oauth/callback \n${String(
          e,
        )}`,
      );
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        message: `An unknown error has occurred (Request Id: ${requestId})`,
        extendedMessage:
          'Internal server error during OAuth callback processing',
      });
    }
  });

  for (const platform of platforms) {
    app.get(`/platforms/${platform.name}`, (req, res) => {
      try {
        res
          .json(
            platform.verifiers.map((verifier) => {
              return {
                verifierType: verifier.verifierType,
                claimType: verifier.claimType.toInt(),
              };
            }),
          )
          .status(200);
      } catch (e: unknown) {
        const requestId: string = new ObjectId().toString();
        console.error(
          `[500 ERROR] (${requestId}) GET /platforms/${
            platform.name
          } \n${String(e)}`,
        );
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          message: `An unknown error has occurred (Request Id: ${requestId})`,
          extendedMessage: 'Internal server error while fetching platforms',
        });
      }
    });

    for (const verifier of platform.verifiers) {
      const name = verifier.claimType.toInt().toString();
      await verifier.init();

      app.post(
        `/platforms/${name}/${verifier.verifierType}/vouch`,
        handleBinaryOrJson,
        async (req, res) => {
          try {
            const vouchResult = await verifier.requestVouch(handle, req);

            const contentType = req.headers['content-type'];
            if (vouchResult.success) {
              if (contentType === 'application/octet-stream') {
                const responseBuffer = Buffer.from(
                  Core.Protocol.Pointer.encode(vouchResult.value).finish(),
                );
                res.setHeader('Content-Type', 'application/octet-stream');
                res.status(StatusCodes.OK).send(responseBuffer);
              } else {
                res
                  .status(StatusCodes.OK)
                  .json(Core.Protocol.Pointer.toJSON(vouchResult.value));
              }
            } else {
              res
                .status(
                  vouchResult.error.statusCode ??
                    StatusCodes.INTERNAL_SERVER_ERROR,
                )
                .json({
                  message: vouchResult.error.message,
                  extendedMessage: vouchResult.error.extendedMessage,
                });
            }
          } catch (e: unknown) {
            const requestId: string = new ObjectId().toString();
            console.error(
              `[500 ERROR] (${requestId}) POST /platforms/${name}/${
                verifier.verifierType
              }/vouch \n${String(e)}`,
            );
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
              message: `An unknown error has occurred (Request Id: ${requestId})`,
              extendedMessage: 'Internal server error while handling vouch',
            });
          }
        },
      );

      if (verifier instanceof OAuthVerifier) {
        app.get(
          `/platforms/${name}/${verifier.verifierType}/url`,
          async (req, res) => {
            try {
              const result = await verifier.getOAuthURL(
                decodeURIComponent(req.query.redirectUri as string),
              );
              if (result.success) {
                if (typeof result.value === 'string') {
                  res.status(StatusCodes.OK).json({ url: result.value });
                } else if (
                  typeof result.value === 'object' &&
                  'url' in result.value &&
                  'token' in result.value &&
                  'secret' in result.value
                ) {
                  storeOAuthSecret(result.value.token, result.value.secret);
                  res.status(StatusCodes.OK).json({ url: result.value.url });
                } else {
                  console.error(
                    `[500 ERROR] Unexpected success value format from getOAuthURL for platform ${name}`,
                  );
                  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                    message:
                      'Internal server error: Unexpected response format from verifier.',
                    extendedMessage:
                      'Verifier returned an unexpected success value format.',
                  });
                }
              } else {
                writeResult(res, result);
              }
            } catch (e: unknown) {
              const requestId: string = new ObjectId().toString();
              console.error(
                `[500 ERROR] (${requestId}) GET /platforms/${name}/${
                  verifier.verifierType
                }/url \n${String(e)}`,
              );
              res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                message: `An unknown error has occurred (Request Id: ${requestId})`,
                extendedMessage:
                  'Internal server error while fetching OAuth URL',
              });
            }
          },
        );

        app.get(
          `/platforms/${name}/${verifier.verifierType}/token`,
          async (req, res) => {
            try {
              const challenge = req.query.oauthData as string;
              if (!challenge) {
                res.status(StatusCodes.BAD_REQUEST).json({
                  message: 'Missing oauthData parameter',
                  extendedMessage:
                    'The required oauthData query parameter was not provided.',
                });
                return;
              }
              const challengeResponse = decodeObject<any>(challenge);
              writeResult(res, await verifier.getToken(challengeResponse));
            } catch (e: unknown) {
              const requestId: string = new ObjectId().toString();
              console.error(
                `[500 ERROR] (${requestId}) GET /platforms/${name}/${
                  verifier.verifierType
                }/token \n${String(e)}`,
              );
              if (e instanceof SyntaxError) {
                res.status(StatusCodes.BAD_REQUEST).json({
                  message: 'Invalid format for oauthData parameter',
                  extendedMessage: `Failed to decode base64 or parse JSON: ${e.message}`,
                });
              } else {
                res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                  message: `An unknown error has occurred (Request Id: ${requestId})`,
                  extendedMessage: `Internal server error while processing OAuth token: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                });
              }
            }
          },
        );
      }

      if (verifier instanceof TextVerifier) {
        app.post(
          `/platforms/${name}/${verifier.verifierType}/getClaimFieldsByUrl`,
          async (req, res) => {
            try {
              return writeResult(
                res,
                await verifier.getClaimFieldsByUrl(req.body.url),
              );
            } catch (e: unknown) {
              const requestId: string = new ObjectId().toString();
              console.error(
                `[500 ERROR] (${requestId}) POST /platforms/${name}/${
                  verifier.verifierType
                }/getClaimFieldsByUrl \n${String(e)}`,
              );
              res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                message: `An unknown error has occurred (Request Id: ${requestId})`,
                extendedMessage:
                  'Internal server error while fetching claim fields',
              });
            }
          },
        );
      }

      app.get(
        `/platforms/${name}/${verifier.verifierType}/healthCheck`,
        async (req, res) => {
          try {
            return writeResult(res, await verifier.healthCheck());
          } catch (e: unknown) {
            const requestId: string = new ObjectId().toString();
            console.error(
              `[500 ERROR] (${requestId}) GET /platforms/${name}/${
                verifier.verifierType
              }/healthCheck \n${String(e)}`,
            );
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
              message: `An unknown error has occurred (Request Id: ${requestId})`,
              extendedMessage:
                'Internal server error while processing health checks',
            });
          }
        },
      );

      console.log(
        `Initialized verifier with type '${
          verifier.verifierType
        }' for platform '${name}' (${Core.Models.ClaimType.toString(
          verifier.claimType,
        )}).`,
      );
    }
  }
  app.listen(3002, () => {
    console.log(`Verifiers server listening on port ${3002}`);
  });
})();
