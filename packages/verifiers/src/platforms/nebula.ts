import {
  TextVerifier,
  TextVerifierGetClaimFieldsTestData,
  TextVerifierVerificationTestData,
} from '../verifier';
import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios } from '../utility';

import * as Core from '@polycentric/polycentric-core';

class NebulaTextVerifier extends TextVerifier {
  protected testDataVerification: TextVerifierVerificationTestData[] = [
    {
      expectedText: `A closer look at our awesome universe. Videos about science, humanities, and everything I find fascinating.`,
      claimFields: <ClaimField[]>[{ key: 0, value: 'technicality' }],
    },
  ];
  protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
    {
      url: 'https://nebula.tv/futo',
      expectedClaimFields: [{ key: 0, value: 'futo' }],
    },
  ];

  constructor() {
    super(Core.Models.ClaimType.ClaimTypeNebula);
  }

  protected async getText(claimField: ClaimField): Promise<Result<string>> {
    if (claimField.key !== 0) {
      const msg = `Invalid claim field type ${claimField.key}.`;
      return Result.err({ message: msg, extendedMessage: msg });
    }

    const client = createCookieEnabledAxios();
    const profileResult = await client({
      url: `https://content.api.nebula.app/content/${claimField.value}/`,
    });

    if (profileResult.status !== 200) {
      return Result.err({
        message: 'Unable to find your account',
        extendedMessage: `Failed to get Profile page (${
          profileResult.status
        }): '${profileResult.statusText} (${profileResult.toString()})'.`,
      });
    }

    return Result.ok(profileResult.data.description.trim());
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    const match = /https:\/\/(?:www\.)?nebula\.tv\/([^/]+)\/?/.exec(url);
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

export const Nebula: Platform = {
  name: 'Nebula',
  verifiers: [new NebulaTextVerifier()],
  version: 1,
};
