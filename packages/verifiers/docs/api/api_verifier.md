# API Verifier
The API Verifier is an abstraction to make writing verifiers easier. It is built for verifiers where the main verification is done by making a request to an API and confirming that a Polycentric is included within a given text body.

## Constructor
```typescript
type APIConstructor = {
    claimType: ClaimType
    documentationImages?: DocumentationImage[]
    getBio?: (data: { [key: string]: any }) => Result<string>
    getBioAsync?: (data: { [key: string]: any }, client: AxiosInstance) => Promise<Result<string>>
    getRequest: (id: string, client: AxiosInstance) => Promise<AxiosRequestConfig>
    testData?: TestData | TestData[]
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

### getBioAsync
Either this method or getBio should be implemented.
GetBioAsync is an async version of getBio. It takes in the data returned from the Axios call made with getRequest and returns a javascript object. Axios automatically parses as json. This function includes an Axios client and returns a promise, allowing multiple API calls if necessary.

### getRequest
Formats an Axios request to be made. This function takes in the user's inputted id as well as client, in case the request needs to be authenticated or headers need to be generated dynamically. This function returns a promise that resolves to an AxiosRequestConfig.

### testData
APIVerifier supports automatic testing and health checks. You may submit a single object or an array of objects. Each object should include a handle and an expectedDescription. The handle is the input that will be used to test the verifier. The expectedDescription is the expected output of the verifier. If no testData is passed in, no tests will be run.

## Usage
This is a simple example of the Nebula verifier.
```typescript
import { APIVerifier } from '../verifiers/v1/api_verifier'
import { ClaimType } from '../../dep/polycentric/packages/polycentric-core/src/models'
import { Result } from '../result'

const NebulaVerifier = new APIVerifier({
    claimType: ClaimType.Nebula,
    getRequest: async (id) => {
        return { url: `https://content.api.nebula.app/content/${id}/` }
    },
    getBio: (data) => Result.ok(data.description),
    testData: {
        expectedDescription: `A closer look at our awesome universe. Videos about science, humanities, and everything I find fascinating.`,
        handle: 'technicality',
    },
})
```