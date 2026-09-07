import type { IncomingHttpHeaders } from 'http';
import { type PolycentricClient, SyncStrategy } from '@polycentric/js-core';
import {
  type DecodedClaim,
  fetchClaim,
  parseClaimId,
  publishVerify,
  SCHEMA_NAME,
} from './claims.js';
import {
  type VerificationOutcome,
  verificationDuration,
  verifications,
} from './metrics.js';
import type { ClaimField, TokenResponse } from './models.js';
import type { XOAuthURLResult } from './platforms/x.js';
import { Result } from './result.js';
import { slug } from './utility.js';

export enum VerifierType {
  OAuth = 'oauth',
  Text = 'text',
}

export interface RequestInformation {
  headers: IncomingHttpHeaders;
  // Parsed JSON object (`{ claimId }`) or a raw EventKey Buffer, depending on
  // the request content type.
  body: any;
  url: string;
}

export abstract class Verifier {
  public readonly verifierType: VerifierType;
  // The platform this verifier handles (e.g. 'X', 'YouTube'). Used only for
  // routing/identification — every platform shares one claim schema
  // (SCHEMA_NAME), so this does not select a schema.
  public readonly platform: string;

  constructor(verifierType: VerifierType, platform: string) {
    this.verifierType = verifierType;
    this.platform = platform;
  }

  public async init(): Promise<void> {}
  public async dispose(): Promise<void> {}
  public abstract healthCheck(): Promise<Result<void>>;

  /**
   * Verify the claim referenced by the request (a hex `EventKey` id) and, if it
   * checks out, publish a VerificationVerify as the bot's identity. Returns the
   * hex `EventKey` id of the verify event.
   */
  public async requestVerify(
    client: PolycentricClient,
    req: RequestInformation,
  ): Promise<Result<string>> {
    const labels = {
      platform: slug(this.platform),
      verifier: this.verifierType,
    };
    const end = verificationDuration.startTimer(labels);
    const done = (
      outcome: VerificationOutcome,
      result: Result<string>,
    ): Result<string> => {
      end();
      verifications.inc({ ...labels, outcome });
      return result;
    };

    const contentType = req.headers['content-type'];
    let claimId: string | undefined;

    if (contentType === 'application/json') {
      claimId = req.body?.claimId;
    } else if (contentType === 'application/octet-stream') {
      claimId = Buffer.from(req.body).toString('hex');
    } else {
      return done(
        'bad_request',
        Result.errMsg(`Unsupported content type '${contentType}'.`),
      );
    }

    const eventKey = claimId ? parseClaimId(claimId) : undefined;
    if (!eventKey) {
      return done('bad_request', Result.errMsg('Missing or invalid claim id.'));
    }

    const claimResult = await fetchClaim(client, eventKey);
    if (!claimResult.success) {
      return done('claim_fetch_failed', Result.err(claimResult.error));
    }
    const claim = claimResult.value;

    if (claim.schemaName !== SCHEMA_NAME) {
      return done(
        'schema_mismatch',
        Result.errMsg(
          `Claim schema '${claim.schemaName}' is not a '${SCHEMA_NAME}' claim.`,
        ),
      );
    }

    // The claim's platform must match the verifier handling it.
    if (claim.platform && claim.platform !== slug(this.platform)) {
      return done(
        'platform_mismatch',
        Result.errMsg(
          `Claim is for platform '${claim.platform}', not '${slug(this.platform)}'.`,
        ),
      );
    }

    const shouldVerifyResult = await this.shouldVerify(claim, req);
    if (!shouldVerifyResult.success) {
      return done('rejected', Result.err(shouldVerifyResult.error));
    }

    let verifyId: string;
    try {
      verifyId = await publishVerify(client, claim.eventKey);
    } catch (e) {
      return done(
        'publish_failed',
        Result.errMsg(
          `Failed to publish verification: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    // Delivery to servers is best-effort — the verify is already committed
    // locally and will be pushed on the next sync if this fails.
    try {
      await client.sync(SyncStrategy.PARTIAL_PUSH);
    } catch (e) {
      console.warn('Failed to push verification to servers:', e);
    }

    console.info('requestVerify(200): Verified claim.', verifyId);
    return done('ok', Result.ok(verifyId));
  }

  protected abstract shouldVerify(
    claim: DecodedClaim,
    req: RequestInformation,
  ): Promise<Result<void>>;
}

export abstract class OAuthVerifier<T> extends Verifier {
  constructor(platform: string) {
    super(VerifierType.OAuth, platform);
  }

  public abstract getOAuthURL(): Promise<Result<string | XOAuthURLResult>>;
  public abstract getToken(data: T): Promise<Result<TokenResponse>>;
  public abstract isTokenValid(
    challengeResponseInput: string,
    claimFields: ClaimField[],
  ): Promise<Result<void>>;

  protected async shouldVerify(
    claim: DecodedClaim,
    req: RequestInformation,
  ): Promise<Result<void>> {
    const query = req.url.substring(req.url.indexOf('?') + 1);
    const challenge = new URLSearchParams(query).get('challengeResponse');

    if (challenge === null) {
      return Result.errMsg('Missing challengeResponse');
    }

    return await this.isTokenValid(challenge, claim.fields);
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

  constructor(platform: string) {
    super(VerifierType.Text, platform);
  }

  /** Claim types the URL fixtures produce. */
  public get parsedClaimTypes(): number[] {
    return this.testDataGetClaimFields.flatMap((data) =>
      data.expectedClaimFields.map((field) => field.key),
    );
  }

  /** Claim types `healthCheck` fetches a profile for. */
  public get checkedClaimTypes(): number[] {
    return this.testDataVerification.flatMap((data) =>
      data.claimFields.map((field) => field.key),
    );
  }

  /**
   * Check the profile the fields point at contains the loop-back token.
   * Used to verify published claims and as the client pre-check.
   */
  public async checkFields(
    claimFields: ClaimField[],
    expectedToken: string,
  ): Promise<Result<void>> {
    for (const claimField of claimFields) {
      const descriptionResult = await this.getText(claimField);
      if (!descriptionResult.success) {
        return Result.err(descriptionResult.error);
      }

      if (!descriptionResult.value.includes(expectedToken)) {
        return Result.err({
          message: 'Unable to find token in your profile description',
          extendedMessage: `Expected token '${expectedToken}' was not found in description '${
            descriptionResult.value
          }' for claimField '${JSON.stringify(claimField)}'.`,
        });
      }
    }

    return Result.ok();
  }

  protected async shouldVerify(claim: DecodedClaim): Promise<Result<void>> {
    console.info(`Expected token: '${claim.expectedToken}'.`);
    return this.checkFields(claim.fields, claim.expectedToken);
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
        const matchingClaimField = data.expectedClaimFields.find(
          (v) => v.key === claimField.key,
        );
        if (!matchingClaimField) {
          return Result.err({
            message: 'Claim field matching with key is not found',
            extendedMessage: JSON.stringify(claimField),
          });
        }

        if (matchingClaimField.value !== claimField.value) {
          return Result.err({
            message: 'Matching claim field value does not match',
            extendedMessage:
              JSON.stringify(claimField) +
              '!==' +
              JSON.stringify(matchingClaimField),
          });
        }
      }
    }

    return Result.ok();
  }

  protected abstract getText(claimField: ClaimField): Promise<Result<string>>;
  public abstract getClaimFieldsByUrl(
    url: string,
  ): Promise<Result<ClaimField[]>>;
}
