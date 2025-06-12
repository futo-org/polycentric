import * as dotenv from 'dotenv';

dotenv.config({ path: './.test.env' });

import { describe, test } from '@jest/globals';
import { Github } from './platforms/github';
import { HackerNews } from './platforms/hackernews';
import { Instagram } from './platforms/instagram';
import { Kick } from './platforms/kick';
import { Minds } from './platforms/minds';
import { Nebula } from './platforms/nebula';
import { Odysee } from './platforms/odysee';
import { Patreon } from './platforms/patreon';
import { Rumble } from './platforms/rumble';
import { SoundCloud } from './platforms/soundcloud';
import { Substack } from './platforms/substack';
import { Twitch } from './platforms/twitch';
import { Vimeo } from './platforms/vimeo';
import { Youtube } from './platforms/youtube';
import { Website } from './platforms/website';
import type { ClaimField, Platform } from './models';
import { TextVerifier } from './verifier';
import { Gitlab } from './platforms/gitlab';
import { Result } from './result';
import { platforms } from './platforms/platforms';
import { Spreadshop } from './platforms/spreadshop';

import * as Core from '@polycentric/polycentric-core';

//const TEST_SERVER = 'http://127.0.0.1:8081';
const TEST_SERVER = 'https://serv1-stg.polycentric.io';

export const tests: { ci: boolean; platform: Platform }[] = [
  { ci: true, platform: Github },
  { ci: true, platform: Gitlab },
  { ci: true, platform: HackerNews },
  { ci: false, platform: Instagram },
  { ci: true, platform: Kick },
  { ci: false, platform: Minds },
  { ci: true, platform: Nebula },
  { ci: true, platform: Odysee },
  { ci: true, platform: Patreon },
  { ci: true, platform: Rumble },
  { ci: true, platform: SoundCloud },
  { ci: true, platform: Spreadshop },
  { ci: true, platform: Substack },
  { ci: true, platform: Twitch },
  { ci: true, platform: Vimeo },
  { ci: true, platform: Youtube },
  { ci: true, platform: Website },
];

test(`all text verifiers tested`, async () => {
  for (const p of platforms) {
    const hasTextVerifier = p.verifiers.some((v) => v instanceof TextVerifier);
    if (!hasTextVerifier) {
      continue;
    }

    const matchedTest = tests.find((v) => v.platform.name === p.name);
    if (!matchedTest) {
      throw new Error(`Platform ${p.name} was not found in tests`);
    }
  }
});

for (const currentTest of tests) {
  describe(currentTest.platform.name, () => {
    for (const verifier of currentTest.platform.verifiers) {
      if (verifier instanceof TextVerifier) {
        test(`(${currentTest.ci ? 'CI' : 'LOCAL'}) ${
          verifier.verifierType
        } health check`, async () => {
          await verifier.init();
          const result = await verifier.healthCheck();
          await verifier.dispose();
          expect(result.success).toBe(true);
        });
      }
    }
  });
}

class DummyVerifier extends TextVerifier {
  private readonly text: string;

  constructor(claimType: Core.Models.ClaimType.ClaimType, text: string) {
    super(claimType);
    this.text = text;
  }

  protected async getText(): Promise<Result<string>> {
    return Result.ok(this.text);
  }

  public async getClaimFieldsByUrl(): Promise<Result<ClaimField[]>> {
    throw Error('Not implemented');
  }
}

describe('requestVouch', () => {
  test(`text success`, async () => {
    const handle = await Core.ProcessHandle.createTestProcessHandle();
    await handle.addServer(TEST_SERVER);
    const expectedPublicKey = Buffer.from(handle.system().key).toString(
      'base64',
    );
    const claimPointer = await handle.claim(
      Core.Models.claimHackerNews('test'),
    );
    await Core.Synchronization.backFillServers(handle, handle.system());

    const verifier: TextVerifier = new DummyVerifier(
      Core.Models.ClaimType.ClaimTypeHackerNews,
      expectedPublicKey,
    );
    await verifier.init();
    const vouchResult = await verifier.requestVouch(handle, {
      body: Core.Protocol.Pointer.encode(claimPointer).finish(),
      headers: {
        'content-type': 'application/octet-stream',
      },
      url: 'https://fake.com', //unused for text verifier
    });

    expect(vouchResult.success).toBe(true);
    expect(vouchResult.value).toBeDefined();
    await verifier.dispose();

    const events = await Core.APIMethods.getEvents(
      TEST_SERVER,
      vouchResult.value.system,
      Core.Models.Ranges.rangesForSystemFromProto({
        rangesForProcesses: [
          {
            process: vouchResult.value.process,
            ranges: [
              {
                low: vouchResult.value.logicalClock,
                high: vouchResult.value.logicalClock,
              },
            ],
          },
        ],
      }),
    );

    if (events.events.length < 1) {
      throw new Error('Event not found on server');
    }
  });

  test(`text fail`, async () => {
    const handle = await Core.ProcessHandle.createTestProcessHandle();
    await handle.addServer(TEST_SERVER);
    const expectedPublicKey = Buffer.from(handle.system().key).toString(
      'base64',
    );
    const claimPointer = await handle.claim(
      Core.Models.claimHackerNews('test'),
    );
    await Core.Synchronization.backFillServers(handle, handle.system());

    const verifier: TextVerifier = new DummyVerifier(
      Core.Models.ClaimType.ClaimTypeBitcoin,
      expectedPublicKey,
    );
    await verifier.init();
    const vouchResult = await verifier.requestVouch(handle, {
      body: Core.Protocol.Pointer.encode(claimPointer).finish(),
      headers: {
        'content-type': 'application/octet-stream',
      },
      url: 'https://fake.com', //unused for text verifier
    });

    expect(vouchResult.success).toBe(false);
    await verifier.dispose();
  });
});
