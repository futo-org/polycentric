import { Result } from '../result';
import { ClaimField, Platform } from '../models';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';
import { createCookieEnabledAxios } from '../utility';

import * as Core from '@polycentric/polycentric-core';

class WebsiteTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        /*TODO: No test data exists yet
        {
            expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
            claimFields: <ClaimField[]> [
                { key: Long.fromInt(0), value: 'osotnoc.futo.org' } 
            ]
        }*/
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://futo.org/',
            expectedClaimFields: [{ key: 0, value: 'https://futo.org/' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeWebsite);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        /*TODO this should probably be more like a domain claim or host claim?
        const id = claimField.value;
        const records = await dns.promises.resolveTxt(id);
        if (records.length == 0) {
            return Result.err({
                message: `Did not find TXT record on ${id}`,
                extendedMessage: `Did not find TXT record on ${id}`,
            });
        }

        let combinedRecords = '';
        for (let i = 0; i < records.length; i++) {
            combinedRecords += records[i];
        }

        return Result.ok(combinedRecords);*/

        const client = createCookieEnabledAxios();
        const response = await client.get(claimField.value);
        if (response.status !== 200) {
            return Result.err({
                message: `Failed to retrieve website from URL ${claimField.value}`,
            });
        }

        return response.data;
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        return Result.ok([
            {
                key: 0,
                value: url,
            },
        ]);
    }
}

export const Website: Platform = {
    name: 'Website',
    verifiers: [new WebsiteTextVerifier()],
    version: 1,
};
