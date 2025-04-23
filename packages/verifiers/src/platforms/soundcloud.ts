import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import {
  TextVerifier,
  TextVerifierGetClaimFieldsTestData,
  TextVerifierVerificationTestData,
} from '../verifier';
import { AxiosInstance } from 'axios';

import * as Core from '@polycentric/polycentric-core';

class SoundCloudTextVerifier extends TextVerifier {
  private userAgentDesktop =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
  private userAgentMobile =
    'Mozilla/5.0 (Linux; Android 10; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

  protected testDataVerification: TextVerifierVerificationTestData[] = [
    {
      expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
      claimFields: <ClaimField[]>[
        { key: 0, value: 'osotnoc' },
        { key: 1, value: '1282027346' },
      ],
    },
  ];
  protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
    {
      url: 'https://soundcloud.com/osotnoc',
      expectedClaimFields: [
        { key: 0, value: 'osotnoc' },
        { key: 1, value: '1282027346' },
      ],
    },
  ];

  constructor() {
    super(Core.Models.ClaimType.ClaimTypeSoundcloud);
  }

  protected async getText(claimField: ClaimField): Promise<Result<string>> {
    switch (claimField.key) {
      case 0:
        return this.getTextFromUsername(claimField.value);
      case 1:
        return this.getTextFromInternalId(claimField.value);
      default: {
        const msg = `Invalid claim field type ${claimField.key}.`;
        return Result.err({ message: msg, extendedMessage: msg });
      }
    }
  }

  private async getTextFromUsername(username: string): Promise<Result<string>> {
    const client = createCookieEnabledAxios();
    const url = `https://soundcloud.com/${username}`;
    const profileResponse = await this.callUrl(client, url);

    if (profileResponse.status !== 200) {
      return Result.err({
        message: 'Unable to find your SoundCloud account',
        extendedMessage: `Failed to get Profile page (${
          profileResponse.status
        }): '${
          profileResponse.statusText
        } (${profileResponse.toString()}) on url '${url}'.`,
      });
    }

    const html = profileResponse.data.toString();
    const matched = html.match(/window\.__sc_hydration = (.+);/);

    if (!matched) {
      return Result.err({
        message: 'SoundCloud profile page error',
        extendedMessage: `SoundCloud page has hydrated differently than expected. Failed to match window.__sc_hydration`,
      });
    }

    const json = JSON.parse(matched[1]);

    for (const object of json) {
      if (object.hydratable === 'user') {
        return Result.ok(object.data.description);
      }
    }

    return Result.err({
      message: 'SoundCloud profile page error',
      extendedMessage: `User object not found in window.__sc_hydration`,
    });
  }

  private async getTextFromInternalId(id: string): Promise<Result<string>> {
    const client = createCookieEnabledAxios();
    const homeResponse = await this.callUrl(
      client,
      `https://soundcloud.com/discover`,
      true,
    );
    if (homeResponse.status !== 200) {
      return Result.err({
        message: 'Failed to get home page',
        extendedMessage: `Failed to get home page (${homeResponse.status}): '${
          homeResponse.statusText
        } (${homeResponse.toString()})'.`,
      });
    }

    const clientIdMatch = homeResponse.data.match(
      /"clientId":"([a-zA-Z0-9-_]+)"/,
    );
    if (!clientIdMatch) {
      return Result.err({ message: 'Failed to find client id' });
    }

    const clientId = clientIdMatch[1];
    const apiProfileUrl = `https://api-v2.soundcloud.com/users/${id}?client_id=${clientId}`;
    const profileResponse = await this.callUrl(client, apiProfileUrl, true);
    if (profileResponse.status !== 200) {
      return Result.err({
        message: 'Unable to find your SoundCloud account',
        extendedMessage: `Failed to get API profile page (${
          profileResponse.status
        }): '${
          profileResponse.statusText
        } (${profileResponse.toString()})' on URL ('${apiProfileUrl}').`,
      });
    }

    const description = profileResponse.data?.description;
    if (!description) {
      return Result.err({ message: 'Failed to get description.' });
    }

    return Result.ok(description);
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    //TODO: Implement API URL? for now seems useless
    const match = /https:\/\/(?:www\.)?soundcloud\.com\/([^/]+)\/?/.exec(url);
    if (!match) {
      return Result.err({ message: 'Failed to match regex' });
    }

    const username = match[1];
    const u = `https://soundcloud.com/${username}`;
    const client = createCookieEnabledAxios();
    const profileResponse = await this.callUrl(client, u);
    if (profileResponse.status !== 200) {
      return Result.err({ message: `Failed to get profile on url '${u}'.` });
    }

    const html = profileResponse.data.toString();
    const matched = html.match(/window\.__sc_hydration = (.+);/);
    if (!matched) {
      return Result.err({
        message: 'SoundCloud profile page error',
        extendedMessage: `SoundCloud page has hydrated differently than expected. Failed to match window.__sc_hydration`,
      });
    }

    let internalId: string | undefined;
    const json = JSON.parse(matched[1]);
    for (const object of json) {
      if (object.hydratable === 'user') {
        internalId = object.data.id.toString();
      }
    }

    if (!internalId) {
      return Result.err({
        message: 'SoundCloud profile page error',
        extendedMessage: `SoundCloud page did not contain internal id`,
      });
    }

    return Result.ok([
      {
        key: 0,
        value: username,
      },
      {
        key: 1,
        value: internalId,
      },
    ]);
  }

  private callUrl(client: AxiosInstance, url: string, useMobile = false) {
    const headers = {
      'User-Agent': useMobile ? this.userAgentMobile : this.userAgentDesktop,
    };

    return client.get(url, { headers });
  }
}

export const SoundCloud: Platform = {
  name: 'SoundCloud',
  verifiers: [new SoundCloudTextVerifier()],
  version: 1,
};
