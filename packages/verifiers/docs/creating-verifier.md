---
label: Creating a verifier
icon: tools 
order: 6
---


To setup your development environment, follow the steps in [Getting Started](getting-started)


## Platform Definition

Once you have your development environment set up, you will want to create a file for your verifier at 
`src/platforms/custom/[plugin name].ts`. For this example, we will use the fictional social platform "Osotnoc Social".

In `src/platforms/custom/osotnoc_social.ts` you will need to create a platform definition similar to the following:

```typescript
import { Platform } from '../../types'

export const OsotnocSocial: Platform = {
    name: 'OsotnocSocial',
    imageUrl: 'https://your.verifier.com/assets/logo.svg',
    platformUrl: 'social.osotnoc.com',
    verifiers: [],
    version: 1,
}

exports.platform = OsotnocSocial
```

!!!
imageUrl should link to an svg image that is hosted on your verifiers server. Using images found on Google Search
or similar is not recommended.
!!!

You can find more details about platforms by reading the [API specification for platform](api/platform).

## Adding your Platform to the Polycentric Protocol

!!!
Note that if the platform already exists, this step is not required
!!!

Currently, all platforms that can be verified must have a `ClaimType` in the Polycentric protocol. Unfortunately, the only way to add this is by making a PR in the [Polycentric Gitlab Repo](https://gitlab.futo.org/polycentric/polycentric). The file you need to edit is located at `packages/polycentric-core/src/models.ts` within the Polycentric repo. You would add your platform to this Enum like so:

```typescript #2
export enum ClaimType {
    OsotnocSocial = 'OsotnocSocial',
    HackerNews = 'HackerNews',
    YouTube = 'YouTube',
    Odysee = 'Odysee',
    Rumble = 'Rumble',
    Twitter = 'Twitter',
    Bitcoin = 'Bitcoin',
    Generic = 'Generic',
    Discord = 'Discord',
    Instagram = 'Instagram',
    GitHub = 'GitHub',
    Minds = 'Minds',
    Patreon = 'Patreon',
    Substack = 'Substack',
    Twitch = 'Twitch',
    Website = 'Website',
    Kick = 'Kick',
    Soundcloud = 'Soundcloud',
    Vimeo = 'Vimeo',
    Nebula = 'Nebula',
    URL = 'URL',
    Occupation = 'Occupation',
    Skill = 'Skill',
    Spotify = 'Spotify',
    Spreadshop = 'Spreadshop'
}
```
 
For testing purposes, you can edit this file directly on your local machine instead of making a PR. It will be located at `dep/polycentric/packages/polycentric-core/src/models.ts` in the verifiers repo.
Making a PR is only required when you wish to ship your plugin.

!!!
We are working to remove this requirement, making this step unnecessary in the future
!!!

## Picking which type of verifier to use

You can use any method to verify that a user owns a profile on a platform. Currently, the preinstalled verifiers use the 
following methods, which we recommend you use if possible:

- **OAuth:** This option lets the user use [OAuth](https://en.wikipedia.org/wiki/OAuth) to sign in with their account on a
platform to verify that they own that account. This option is generally the best choice as it is the most user-friendly and the least-prone to breaking.

- **Description via Official API:** This option involves querying the user's profile on a platform using the platform's official public API.
The user verifies ownership of the account by putting their Polycentric public key in their profile description/bio which the verifier
checks for. This is generally easy to write and not very prone to breaking; however, provides a poor user experience.

- **Description via Unofficial API/Scraping:** This option involves querying the user's profile on a platform using the platform's private API or scraping it from a web page. The user verifies ownership of the account by putting their Polycentric public key in their profile description/bio which the verifier checks for. This is generally moderately easy to write, prone to breaking, and provides a poor user experience.

You can implement many of these verifier methods for one platform, which is recommended. It allows users to pick their preferred verification method and also allows users to verify their profile even if one verifier for a platform breaks. 

With all of the above types of verifiers, there are utility classes and functions provided to make writing new verifiers easy.

## Writing a verifier using utility classes/functions

We strongly recommend you use these utility classes/functions as they will reduce the complexity of your code and make it more maintainable. The imports for these functions require passing version numbers. New versions will come out with breaking changes. Currently, `v1` is the only and latest version.

### Using OAuthVerifier for OAuth Verification
This class adds abstractions to help write OAuth-based verifiers. It requires that you supply functions to get an OAuth URL, exchange an OAuth Code for a Token, and verify that a Token is valid for a given username. 

Detailed documentation about the OAuth Verifier class is available [here](api/oauth_verifier).

Verifiers that use the OAuth Verifier and are good implementation examples are:
- Discord
- Instagram
- Spotify
- X/Twitter

Here is an example implementation of the OAuth verifier:

```typescript
import { APIVerifier } from '../verifiers/v1/api_verifier'
import { ClaimType } from '../../../dep/polycentric/packages/polycentric-core/src/models'
import { createCookieEnabledAxios, httpResponseToError } from '../utility'
import { OAuthVerifier } from '../../verifiers/v1/oauth_verifier'
import { Result } from '../../result'
import { StatusCodes } from 'http-status-codes'
import { TokenResponse } from '../../types'

// This should represent the query string
// returned by the redirect URL
type OsotnocSocialTokenRequest = {
    code: string
};

const OsotnocSocialOAuthVerifier = new OAuthVerifier({
    claimType: ClaimType.OsotnocSocial,
    // Get the URL to redirect the user to so that they can log in to the platform.
    // Passing a URI parameter called harborSocial here will make it so that it 
    // is included in OsotnocSocialTokenRequest in the getToken function (you must
    // update the type definition for OsotnocSocialTokenRequest for this to work).
    // It is useful for platforms like X/Twitter. 
    getUrl: async () => Result.ok(process.env.OSOTNOC_SOCIAL_OAUTH_URL),
    // Take an OAuth code and turn it into a token. Also return the user's username for use by the client
    getToken: async (tokReq: OsotnocSocialTokenRequest): Promise<Result<TokenResponse>> => {
        const client = createCookieEnabledAxios()
        const form = new FormData()
        form.append('client_id', process.env.OSOTNOC_SOCIAL_CLIENT_ID)
        form.append('client_secret', process.env.OSOTNOC_SOCIAL_CLIENT_SECRET)
        form.append('grant_type', 'authorization_code')
        form.append('redirect_uri', process.env.OSOTNOC_SOCIAL_CALLBACK_URL)
        form.append('code', tokReq.code)
        const tokenResponse = await client.post('https://social.osotnoc.com/api/oauth/access_token', form)

        if (tokenResponse.status !== StatusCodes.OK) {
            return httpResponseToError(tokenResponse.status, tokenResponse.data, 'Osotnoc Social API /oauth/access_token')
        }

        const accessToken = tokenResponse.data.access_token

        const response = await client.get('https://social.osotnoc.com/api/me', {
            params: {
                fields: 'username',
                access_token: accessToken,
            },
        })

        if (response.status === StatusCodes.OK) {
            return Result.ok({ username: response.data.username, token: accessToken })
        }

        return httpResponseToError(response.status, response.data, 'Osotnoc Social API /me')
    },
    // Check that the passed token matches the passed username
    isTokenValid: async (token: string, username: string) => {
        const client = createCookieEnabledAxios()
        const response = await client.get('https://social.osotnoc.com/api/me', {
            params: {
                fields: 'username',
                access_token: token,
            },
        })

        if (response.data.username !== username) {
            return Result.err({
                message: "The username didn't match the account you logged in with",
                extendedMessage: `Username did not match (expected: ${username}, got: ${response.data.username})`,
            })
        }

        return Result.ok()
    },
})
```
### Using APIVerifier for Description Verification

This class adds abstractions to help write description-based verifiers. It requires that you supply a function to get the axios request parameters and a function to extract the user's profileDescription/bio from the result of a request to the URL. There are sync and async versions of getBio. It also optionally allows you to pass an id and description (or an array of them) that will be used to automatically test your verifier.

Detailed documentation about the API Verifier class is available [here](api/api_verifier).

Verifiers that use the API Verifier and are good implementation examples are:
- GitHub
- HackerNews
- Instagram
- Minds
- Nebula
- Patreon
- Rumble
- Soundcloud
- Spreadshop
- Substack
- Twitch
- Vimeo
- YouTube

Here is an example implementation of the API verifier:

```typescript
import { APIVerifier } from '../verifiers/v1/api_verifier'

const OsotnocSocialAPIVerifier = new APIVerifier({
    claimType: ClaimType.OsotnocSocial,
    getRequest: async (id) => {
            url: `https://api.vimeo.com/users/${id}?fields=bio&fetch_user_profile=1`,
            headers: {
                Authorization: `Basic MyAPIKey`,
            },
    },
    getBio: (data) => Result.ok(data.profileDescription),
    testData: {
        expectedDescription: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
        handle: 'osotnoc-corp',
    },
})
```

### Using PuppeteerVerifier for Description Verification

!!!
This is resource-intensive and not very reliable. Use the API verifier if possible. It should only be used on websites with advanced security measures that stop the APIVerifier from working.
!!!

This class adds abstractions to help write Description-based verifiers on sites with advanced security measures. It requires that you supply a funciton to get a URL to the user's profile and a function
to extract the user's profileDescription/bio from the result of making a request to the URL. It also optionally allows you to pass a id and description (or an array of them) that will be used to automatically test your verifier.

Detailed documentation about the API Verifier class is avaliable [here](api/puppeteer-verifier).

Verifiers that use the Puppeteer Verifier and are good implementation examples are:
- GitLab
- Kick 

Here is an example implementation of the Puppeteer verifier:

```typescript
import { PuppeteerVerifier } from '../verifiers/v1/puppeteer_verifier'

export const OsotnocSocialPuppeteerVerifier = new PuppeteerVerifier({
    claimType: ClaimType.OsotnocSocial,
    getUrl: (id) => `https://social.osotnoc.com/${id}`,
    getBio: (pageData) => {
        const match = /<meta content="([^"]+)" property="og:description">/.exec(pageData)

        if (!match) {
            return Result.err({
                message: 'Verifier encountered an error attempting to check your profile description',
                extendedMessage: 'Failed to find description meta tag.',
            })
        }

        return Result.ok(match[1])
    },
    testData: {
        expectedDescription: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
        handle: 'osotnoc-corp',
    },
})
```

## Implementing your own verifier from scratch

To implement your own verifier from scratch, you wil have to extend the base Verifiers class. For this, you should reference the source 
for the Verifiers class and the [API Documentation for the Verifiers class](api/verifier). 

The Odysee verifier currently is implemented from scratch and is a good implementation example.

For example, creating a Description verifier for OsotnocSocial from scratch, we would write:

```typescript
class OsotnocSocialCustomVerifier extends Verifier {
    protected claimType = ClaimType.OsotnocSocial
    protected strategy = Strategy.Description // must be in stratagy enum in types.ts or an arbitrary string
    protected documentationImages = []

    public async shouldVouchFor(claimPointer: Models.Pointer.Pointer, claim: Protocol.Claim): Promise<Result> {
        const platformUsername = ClaimIdentifier.decode(claim.claim).identifier
        const expectedPublicKey = Buffer.from(claimPointer.system.key).toString('base64')

        const userDescription = OsotnocSDK.getUserDescription(platformUsername);

        if (!userDescription.includes(expectedPublicKey)) {
            return Result.err({
                message: 'Unable to find token in your profile description',
                extendedMessage: `Expected public key '${expectedPublicKey}' was not found in description '${userDescription}'.`,
            })
        }

        return Result.ok()
    }
}
```

There are other functions you can extend to help with your implementation. The function definitions and their descriptions can be found in the
[API Documentation for the Verifiers class](api/verifier)

## Associating your verifiers with your platform

You must add your verifiers to the Platform object you made for them to be detected by the server. You would do this like so:

```typescript  #5
export const OsotnocSocial: Platform = {
    name: 'OsotnocSocial',
    imageUrl: 'https://your.verifier.com/assets/logo.svg',
    platformUrl: 'social.osotnoc.com',
    verifiers: [new OsotnocSocialCustomVerifier(), OsotnocSocialPuppeteerVerifier, OsotnocSocialAPIVerifier, OsotnocSocialOAuthVerifier],
    version: 1,
}
```

## Shipping your plugin

You need to ensure that all of your code is in one `.ts` file. All types/classes/funcitons should be moved to a single `[platform name].ts` if 
they are not already. Once you have this done, ensure that you have added your platform to the Polycentric protocol by making a PR into the 
Polycentric git repo as [described above](creating-verifier/#adding-your-platform-to-the-polycentric-protocol). After this is merged, distribute your
`.ts` file to others. They can install it by following the [steps described in the Hosting section](hosting/#installing-custom-verifiers).
