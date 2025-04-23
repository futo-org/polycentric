import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import parse from 'node-html-parser';
import {
  TextVerifier,
  TextVerifierGetClaimFieldsTestData,
  TextVerifierVerificationTestData,
} from '../verifier';
import { createCookieEnabledAxios } from '../utility';

import * as Core from '@polycentric/polycentric-core';

class RumbleTextVerifier extends TextVerifier {
  protected testDataVerification: TextVerifierVerificationTestData[] = [
    {
      expectedText: '8YTgkgK6jTImETJdUa+kd7HURgZrhKjLVDL6yp5ETik=',
      claimFields: <ClaimField[]>[{ key: 0, value: 'koenfuto' }],
    },
    {
      expectedText: '8YTgkgK6jTImETJdUa+kd7HURgZrhKjLVDL6yp5ETik=',
      claimFields: <ClaimField[]>[{ key: 1, value: 'c-3366838' }],
    },
  ];
  protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
    {
      url: 'https://rumble.com/user/futo',
      expectedClaimFields: [{ key: 0, value: 'futo' }],
    },
    {
      url: 'https://rumble.com/c/c-213123',
      expectedClaimFields: [{ key: 1, value: 'c-213123' }],
    },
  ];

  constructor() {
    super(Core.Models.ClaimType.ClaimTypeRumble);
  }

  protected async getText(claimField: ClaimField): Promise<Result<string>> {
    switch (claimField.key) {
      case 0:
        return this.getTextFromUser(claimField.value);
      case 1:
        return this.getTextFromChannel(claimField.value);
      default: {
        const msg = `Invalid claim field type ${claimField.key}.`;
        return Result.err({ message: msg, extendedMessage: msg });
      }
    }
  }

  private async getTextFromChannel(id: string): Promise<Result<string>> {
    const client = createCookieEnabledAxios();
    const profileResult = await client({
      url: `https://rumble.com/c/${id}/about`,
    });
    if (profileResult.status !== 200) {
      return Result.err({
        message: 'Unable to find your account',
        extendedMessage: `Failed to get Profile page (${
          profileResult.status
        }): '${profileResult.statusText} (${profileResult.toString()})'.`,
      });
    }

    const root = parse(profileResult.data);
    const node = root.querySelector('.channel-about--description');
    if (!node) {
      return Result.err({
        message: `Verifier failed to find channel-about--description on channel id ${id}.`,
        extendedMessage: "Failed to find node '.media-description'",
      });
    }

    return Result.ok(node.structuredText.trim());
  }

  private async getTextFromUser(id: string): Promise<Result<string>> {
    const client = createCookieEnabledAxios();
    const profileResult = await client({
      url: `https://rumble.com/user/${id}`,
    });
    if (profileResult.status !== 200) {
      return Result.err({
        message: 'Unable to find your account',
        extendedMessage: `Failed to get Profile page (${
          profileResult.status
        }): '${profileResult.statusText} (${profileResult.toString()})'.`,
      });
    }

    const match = /(\/v.+html)/.exec(profileResult.data.toString());
    if (!match) {
      return Result.err({
        message: `Verifier failed to find regex video match on user id '${id}'.`,
        extendedMessage: 'Failed to find video URL',
      });
    }

    const firstVideoUrl = `https://rumble.com${match[1]}`;
    const videoResult = await client.get(firstVideoUrl);
    if (videoResult.status !== 200) {
      return Result.err({
        message: `Verifier failed download first video on url '${firstVideoUrl}'.`,
        extendedMessage: `Failed to get Video page (${videoResult.status}): '${videoResult.statusText}'`,
      });
    }

    const root = parse(videoResult.data);
    const node = root.querySelector('.media-description');
    if (!node) {
      return Result.err({
        message: `Verifier failed to find media-description on url '${firstVideoUrl}'.`,
        extendedMessage: "Failed to find node '.media-description'",
      });
    }

    return Result.ok(node.structuredText.trim());
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    const userMatch = /https:\/\/(?:www\.)?rumble\.com\/user\/([^/]+)\/?/.exec(
      url,
    );
    if (userMatch) {
      return Result.ok([
        {
          key: 0,
          value: userMatch[1],
        },
      ]);
    }

    const channelMatch = /https:\/\/(?:www\.)?rumble\.com\/c\/([^/]+)\/?/.exec(
      url,
    );
    if (channelMatch) {
      return Result.ok([
        {
          key: 1,
          value: channelMatch[1],
        },
      ]);
    }

    return Result.err({ message: 'Failed to match either channel or user.' });
  }
}

export const Rumble: Platform = {
  name: 'Rumble',
  verifiers: [new RumbleTextVerifier()],
  version: 1,
};
