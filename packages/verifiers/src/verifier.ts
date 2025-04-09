import { IncomingHttpHeaders } from 'http';
import { ClaimField, TokenResponse } from './models';
import { Result } from './result';

import * as Core from '@polycentric/polycentric-core';

const SERVER_URL = process.env.NODE_ENV === 'development' 
    ? (process.env.DEV_SERVER_URL || 'http://development:8081')
    : (process.env.SERVER_URL || 'https://staging-stage.polycentric.io');

export enum VerifierType {
    OAuth = 'oauth',
    Text = 'text',
}

export interface RequestInformation {
    headers: IncomingHttpHeaders;
    body: Uint8Array;
    url: string;
}

export abstract class Verifier {
    public readonly verifierType: VerifierType;
    public readonly claimType: Core.Models.ClaimType.ClaimType;

    constructor(verifierType: VerifierType, claimType: Core.Models.ClaimType.ClaimType) {
        this.verifierType = verifierType;
        this.claimType = claimType;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    public async init(): Promise<void> {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    public async dispose(): Promise<void> {}
    public abstract healthCheck(): Promise<Result<void>>;

    public async requestVouch(
        handle: Core.ProcessHandle.ProcessHandle,
        req: RequestInformation
    ): Promise<Result<Core.Models.Pointer.Pointer>> {
        let protocolPointer: Core.Protocol.Pointer;
        const contentType = req.headers['content-type'];
        console.info('requestVouch received contentType', contentType);

        if (contentType === 'application/json') {
            protocolPointer = Core.Protocol.Pointer.fromJSON(req.body);
        } else if (contentType === 'application/octet-stream') {
            protocolPointer = Core.Protocol.Pointer.decode(new Uint8Array(Buffer.from(req.body)));
        } else {
            return Result.err({ message: `Unsupported content type '${contentType}'.` });
        }

        const pointer = Core.Models.Pointer.fromProto(protocolPointer);
        console.info('requestVouch pointer', pointer);

        //TODO: Maybe instead of pointer use something that contains a server?
        const events = await Core.APIMethods.getEvents(
            SERVER_URL,  // Use the configured server URL
            pointer.system,
            Core.Models.Ranges.rangesForSystemFromProto({
                rangesForProcesses: [
                    {
                        process: pointer.process,
                        ranges: [
                            {
                                low: pointer.logicalClock,
                                high: pointer.logicalClock,
                            },
                        ],
                    },
                ],
            })
        );

        if (events.events.length < 1) {
            return Result.err({ message: 'requestVouch: Could not find event.' });
        }

        const ev = Core.Models.Event.fromBuffer(events.events[0].event);
        if (ev.contentType.notEquals(Core.Models.ContentType.ContentTypeClaim)) {
            return Result.err({ message: 'requestVouch: This event is not a claim event.' });
        }

        const claim = Core.Protocol.Claim.decode(ev.content);
        if (claim.claimType.notEquals(this.claimType)) {
            return Result.err({
                message: `requestVouch: This event has claim type ${claim.claimType} which is not supported by this verifier ${this.claimType}.`,
            });
        }

        const shouldVouchForResult: Result = await this.shouldVouchFor(pointer, claim, req);
        if (!shouldVouchForResult.success) {
            return Result.err(shouldVouchForResult.error);
        }
        const p = await handle.vouch(pointer);
        console.info(`Logical Clock for request is: ${p.logicalClock}`);
        console.info('requestVouch(200): Vouched for claim.', p);
        await Core.Synchronization.backFillServers(handle, handle.system());
        return Result.ok(p);
    }

    protected abstract shouldVouchFor(
        pointer: Core.Models.Pointer.Pointer,
        claim: Core.Protocol.Claim,
        req: RequestInformation
    ): Promise<Result<void>>;
}
export abstract class OAuthVerifier<TTokenRequest> extends Verifier {
    public verifierType: VerifierType = VerifierType.OAuth;

    constructor(claimType: Core.Models.ClaimType.ClaimType) {
        super(VerifierType.OAuth, claimType);
    }

    public abstract getOAuthURL(): Promise<Result<string>>;
    public abstract getToken(token: TTokenRequest): Promise<Result<TokenResponse>>;
    public abstract isTokenValid(challengeResponse: string, claimFields: ClaimField[]): Promise<Result>;

    protected async shouldVouchFor(
        claimPointer: Core.Models.Pointer.Pointer,
        claim: Core.Protocol.Claim,
        req: RequestInformation
    ): Promise<Result<void>> {
        const query = req.url.substring(req.url.indexOf('?') + 1);

        const challenge = new URLSearchParams(query).get('challengeResponse');

        if (challenge === null) {
            return Result.errMsg('Missing challengeResponse');
        }

        try {
            // Try to decode the challenge as base64
            const oauthCallback = Buffer.from(challenge, 'base64').toString();
            
            const fields: ClaimField[] = claim.claimFields.map((v) => <ClaimField>{ key: v.key.toInt(), value: v.value });
            return await this.isTokenValid(oauthCallback, fields);
        } catch (error) {
            return Result.err({
                message: 'Invalid challenge response format',
                extendedMessage: 'Could not decode the challenge response'
            });
        }
    }
}

export interface TextVerifierVerificationTestData {
    claimFields: ClaimField[];
    expectedText: string;
}

export interface TextVerifierGetClaimFieldsTestData {
    url: string;
    expectedClaimFields: ClaimField[];
}

export abstract class TextVerifier extends Verifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [];

    constructor(claimType: Core.Models.ClaimType.ClaimType) {
        super(VerifierType.Text, claimType);
    }

    protected async shouldVouchFor(claimPointer: Core.Models.Pointer.Pointer, claim: Core.Protocol.Claim): Promise<Result<void>> {
        const expectedPublicKey = Buffer.from(claimPointer.system.key).toString('base64');
        console.info(`Expected public key: '${expectedPublicKey}'.`);

        for (const claimField of claim.claimFields) {
            const descriptionResult = await this.getText({ key: claimField.key.toInt(), value: claimField.value });
            if (!descriptionResult.success) {
                return Result.err(descriptionResult.error);
            }

            if (!descriptionResult.value.includes(expectedPublicKey)) {
                return Result.err({
                    message: 'Unable to find token in your profile description',
                    extendedMessage: `Expected public key '${expectedPublicKey}' was not found in description '${
                        descriptionResult.value
                    }' for claimField '${JSON.stringify(claimField)}'.`,
                });
            }
        }

        return Result.ok();
    }

    public async healthCheck(): Promise<Result<void>> {
        for (const data of this.testDataVerification) {
            for (const claimField of data.claimFields) {
                const result = await this.getText(claimField);
                if (!result.success) {
                    return Result.err(result.error);
                }

                if (!result.value.includes(data.expectedText)) {
                    return Result.err({
                        message: 'Unexpected description',
                        extendedMessage: `Expected description '${data.expectedText}' but found '${result.value}'`,
                    });
                }
            }
        }

        for (const data of this.testDataGetClaimFields) {
            const result = await this.getClaimFieldsByUrl(data.url);
            if (!result.success) {
                return Result.err(result.error);
            }

            for (const claimField of result.value) {
                const matchingClaimField = data.expectedClaimFields.find((v) => v.key === claimField.key);
                if (!matchingClaimField) {
                    return Result.err({
                        message: 'Claim field matching with key is not found',
                        extendedMessage: JSON.stringify(claimField),
                    });
                }

                if (matchingClaimField.value !== claimField.value) {
                    return Result.err({
                        message: 'Matching claim field value does not match',
                        extendedMessage: JSON.stringify(claimField) + '!==' + JSON.stringify(matchingClaimField),
                    });
                }
            }
        }

        return Result.ok();
    }

    protected abstract getText(claimField: ClaimField): Promise<Result<string>>;
    public abstract getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>>;
}
