import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import {
  TextVerifier,
  TextVerifierGetClaimFieldsTestData,
  TextVerifierVerificationTestData,
} from '../verifier';
import parse from 'node-html-parser';

import * as Core from '@polycentric/polycentric-core';

class SpreadshopTextVerifier extends TextVerifier {
  protected testDataVerification: TextVerifierVerificationTestData[] = [
    {
      expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
      claimFields: <ClaimField[]>[{ key: 0, value: 'futo' }],
    },
  ];
  protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
    {
      url: 'https://futo.myspreadshop.com/about',
      expectedClaimFields: [{ key: 0, value: 'futo' }],
    },
  ];

  constructor() {
    super(Core.Models.ClaimType.ClaimTypeSpreadshop);
  }

  protected async getText(claimField: ClaimField): Promise<Result<string>> {
    if (claimField.key !== 0) {
      const msg = `Invalid claim field type ${claimField.key}.`;
      return Result.err({ message: msg, extendedMessage: msg });
    }

    const client = createCookieEnabledAxios();
    const profileResponse = await client.get(
      `https://${claimField.value}.myspreadshop.com/about`,
    );

    if (profileResponse.status !== 200) {
      return Result.err({
        message: 'Unable to find your Spreadshop account',
        extendedMessage: `Failed to get Profile page (${
          profileResponse.status
        }): '${profileResponse.statusText} (${profileResponse.toString()})'.`,
      });
    }

    const dom = parse(profileResponse.data.toString());
    const descriptionBox = dom.querySelector('.sprd-about-info__text');

    if (!descriptionBox) {
      return Result.err({
        message: 'Verifier was unable to check your profile due to an error',
        extendedMessage:
          'Unable to find item with .sprd-about-info__text css class on webpage',
      });
    }

    return Result.ok(descriptionBox.textContent);
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    const match = /https:\/\/(?:www\.)?(.+)\.myspreadshop\.com\/?/.exec(url);
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

export const Spreadshop: Platform = {
  name: 'Spreadshop',
  verifiers: [new SpreadshopTextVerifier()],
  version: 1,
};
