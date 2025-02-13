# OAuth Verifier
The OAuth Veriifer is an abstraction to make writing verifiers easier. It is built for verifiers where the verification is done by having the user authenticate with the platform via OAuth.

## Constructor
```typescript
type OAuthData = {
    claimType: ClaimType
    documentationImages?: DocumentationImage[]
    getUrl: () => Promise<Result<string>>
    getToken: (data: any) => Promise<Result<TokenResponse>>
    isTokenValid: (challengeResponse: any, id: string) => Promise<Result>
}

type DocumentationImage = {
    url: string
    caption: string
}

```

### claimType
This is currently a static enum of types in the Polycentric repo. In the future, Polycentric will support dynamic claim types.

### documentationImages
This is an array of image links that will be displayed in the documentation for the verifier when using a verifier client such as [Harbor](https://harbor.social). For example, documentationImages could include screenshots of how to edit a channel biography on YouTube. If no array is passed in, no images will be displayed.

### getUrl
This function should return a URL which the user could be redirected to in order to sign into the platform. You can add a `harborSecret` URI parameter which the client will store and send with the getToken request. This function returns a promise that resolves to a string Result. 

### getToken
This function takes in an `any` that contains the data returned by the oauth callback inside of an object. It also optionally includes a `harborSecret` property which contains arbitrary data that ws included in the url returned by getUrl. This function returns a promise that resolves to a TokenResponse Result.  

### isTokenValid
This function takes a token and a username as paramaters. It then checks to see wether the token is associated with the username. This function returns a promise that resolves to a void Result.

## Usage

This is an example of an implementation of the OAuth verifier to verify X/Twitter accounts:

```typescript
export type TwitterToken = {
    secret: string
    token: string
}

type TwitterTokenRequest = {
    oauth_token: string
    oauth_verifier: string
    harborSecret: string
}

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
})

const XOAuthVerifier = new OAuthVerifier({
    claimType: ClaimType.Twitter,
    getUrl: async () => {
        let oauthRequest = await twitterClient.generateAuthLink(process.env.TWITTER_CALLBACK_URL)
        return Result.ok(`${oauthRequest.url}&harborSecret=${oauthRequest.oauth_token_secret}`)
    },
    getToken: async (data: TwitterTokenRequest): Promise<Result<TokenResponse>> => {
        try {
            const client = new TwitterApi({
                appKey: process.env.TWITTER_API_KEY,
                appSecret: process.env.TWITTER_API_SECRET,
                accessToken: data.oauth_token,
                accessSecret: data.harborSecret,
            })

            const response = await client.login(data.oauth_verifier)

            return Result.ok({
                username: response.screenName,
                token: encodeObject<TwitterToken>({
                    secret: response.accessSecret,
                    token: response.accessToken,
                }),
            })
        } catch (err) {
            if (err instanceof ApiResponseError) {
                return httpResponseToError(err.code, JSON.stringify(err.data), 'X API Login')
            }

            throw err
        }
    },
    isTokenValid: async (token: string, id: string) => {
        const payload = decodeObject<TwitterToken>(token)
        const client = new TwitterApi({
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: payload.token,
            accessSecret: payload.secret,
        })
        let response = await client.currentUser()

        let res = response.screen_name
        if (res !== id) {
            return Result.err({
                message: "The username didn't match the account you logged in with",
                extendedMessage: `Username did not match (expected: ${id}, got: ${response.screen_name})`,
            })
        }

        return Result.ok()
    },
})
```
