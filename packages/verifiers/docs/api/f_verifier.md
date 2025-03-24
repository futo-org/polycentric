# F Verifier
The F Verifier is an abstract class for creating profile description based verifiers. It is used by the APIVerifier and PuppeteerVerifier classes.

## Constructor
```typescript
type FConstructor = {
    claimType: ClaimType
    documentationImages?: DocumentationImage[]
    strategy: Strategy | string
    testData?: TestData | TestData[]
}

enum Strategy {
    OAuth = 'OAuth',
    Description = 'Description',
    Message = 'Message',
    Cryptographic = 'Cryptographic',
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

### strategy
The strategy that this verifier is implementing. The easiest strategies to implement are OAuth and Description. Message and Cryptographic are more complex and require more work. You may define a custom type by passing any string.

### testData
APIVerifier supports automatic testing and health checks. You may submit a single object or an array of objects. Each object should include a handle and an expectedDescription. The handle is the input that will be used to test the verifier. The expectedDescription is the expected output of the verifier. If no testData is passed in, no tests will be run.

## Usage
FVerifier implements the following methods from Verifier:
```typescript
public abstract shouldVouchFor(claimPointer: Models.Pointer.Pointer, claim: Protocol.Claim, challengeResponse?: string): Promise<Result>

public async healthCheck(): Promise<Result<any>> {
    return Result.ok()
}
```

FVerifier also defines a new abstract method that must be implemented. APIVerifier and PuppeteerVerifier implement this method for you.
```typescript
protected abstract getDescription(client: any, id: string): Promise<Result<string>>
```
