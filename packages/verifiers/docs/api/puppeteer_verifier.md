# Puppeteer Verifier
The Puppeteer Verifier is an abstraction to make writing verifiers easier. It is built for verifiers where the main verification is done by using Puppeteer to scrape a website and confirm that a Polycentric is included within a given text body.

## Constructor
```typescript
type PuppeteerData = {
    claimType: ClaimType
    documentationImages?: DocumentationImage[]
    getBio: (pageData: string) => Result<string>
    getUrl: (id: string) => string
    testData?: TestData
}

type TestData = {
    handle: string
    expectedDescription: string
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

### getBio
Either this method or getBioAsync should be implemented.
Takes in the data returned from the Axios call made with getRequest and returns a javascript object. Axios automatically parses as json. This function returns a Result that is either ok or an error. If the result is ok, it should include text that is expected to have a user's Polycentric public key. If the result is an error, it should include a message that will be displayed to the user.

### getUrl
This method should return the url that will be used to scrape the user's profile. The id of the user is passed in as a parameter to the method to allow the url to be created.

### testData
APIVerifier supports automatic testing and health checks. You may submit a single object or an array of objects. Each object should include a handle and an expectedDescription. The handle is the input that will be used to test the verifier. The expectedDescription is the expected output of the verifier. If no testData is passed in, no tests will be run.

## Usage
This is a simple example of the Kick verifier which requires Puppeteer due to cloudflare.
```typescript
import { ClaimType } from '../../dep/polycentric/packages/polycentric-core/src/models'
import { Platform } from '../types'
import { PuppeteerVerifier } from '../verifiers/v1/puppeteer_verifier'
import { Result } from '../result'
import parse from 'node-html-parser'

export const KickVerifier = new PuppeteerVerifier({
    claimType: ClaimType.Kick,
    getUrl: (id) => `https://kick.com/api/v2/channels/${id}`,
    getBio: (pageData) => {
        try {
            const parsedData = parse(pageData)
            const body = parsedData.getElementsByTagName('body')
            if (body.length == 0) {
                return Result.err({
                    message: 'The verifier encountered unknown error occurred verifying your Kick account',
                    extendedMessage: `Unable to extract body from HTML returned from puppeteer. HTML returned: ${pageData}`,
                })
            }
            const content = body[0].textContent
            const data = JSON.parse(content)
            return Result.ok(data.user.bio)
        } catch {
            return Result.err({
                message: 'The verifier encountered unknown error occurred verifying your Kick account',
                extendedMessage: `An exception was encountered while parsing the HTML from puppeteer. HTML returned: ${pageData}`,
            })
        }
    },
    testData: {
        handle: 'osotnoc',
        expectedDescription:
            'The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization',
    },
})
```