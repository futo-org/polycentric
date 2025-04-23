import {
  TextVerifier,
  TextVerifierGetClaimFieldsTestData,
  TextVerifierVerificationTestData,
} from '../verifier';
import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios } from '../utility';

import * as Core from '@polycentric/polycentric-core';

class MindsTextVerifier extends TextVerifier {
  protected testDataVerification: TextVerifierVerificationTestData[] = [
    {
      expectedText:
        'A new organization founded to develop technology and share knowledge that gives control of computers back to the people.Want to learn more about FUTO and its mission? Check out futo.org',
      claimFields: <ClaimField[]>[{ key: 0, value: 'futo' }],
    },
  ];

  protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
    {
      url: 'https://www.minds.com/futo',
      expectedClaimFields: [{ key: 0, value: 'futo' }],
    },
  ];

  constructor() {
    super(Core.Models.ClaimType.ClaimTypeMinds);
  }

  protected async getText(claimField: ClaimField): Promise<Result<string>> {
    if (claimField.key !== 0) {
      const msg = `Invalid claim field type ${claimField.key}.`;
      return Result.err({ message: msg, extendedMessage: msg });
    }

    const client = createCookieEnabledAxios();
    const profileResult = await client({
      url: `https://www.minds.com/api/v1/channel/${claimField.value}`,
    });

    if (profileResult.status !== 200) {
      return Result.err({
        message: 'Unable to find your account',
        extendedMessage: `Failed to get Profile page (${
          profileResult.status
        }): '${profileResult.statusText} (${profileResult.toString()})'.`,
      });
    }

    return Result.ok(profileResult.data.channel.briefdescription.trim());
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    const match = /https:\/\/(?:www\.)?minds\.com\/([^/]+)\/?/.exec(url);
    if (!match) {
      return Result.err({ message: 'Failed to match regex' });
    }

    return Result.ok([
      {
        key: 0,
        value: match[1],
      },
    ]);
  }
}

export const Minds: Platform = {
  name: 'Minds',
  verifiers: [new MindsTextVerifier()],
  version: 1,
};
