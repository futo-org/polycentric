# Verifier
Verifier is an abstract class for creating any type of verifiers. It is the lowest level class, allowing the most flexibility but also requireing writing more methods.

## claimType
```typescript
protected abstract claimType: ClaimType
```
This is currently a static enum of types in the Polycentric repo. In the future, Polycentric will support dynamic claim types.

## documentationImages
```typescript
protected abstract documentationImages: DocumentationImage[]
```
This is an array of image links that will be displayed in the documentation for the verifier when using a verifier client such as [Harbor](https://harbor.social). For example, documentationImages could include screenshots of how to edit a channel biography on YouTube. These images are not optional. If there are no images, pass in an empty array.

## strategy
```typescript
protected abstract strategy: Strategy
```
The strategy that this verifier is implementing. The easiest strategies to implement are OAuth and Description. Message and Cryptographic are more complex and require more work.

## init
```typescript
public async init?(): Promise<void>
```
This method is called when the verifier is first initialized. It is optional. For example, create a Puppeteer instance so they don't need to keep being spawned and then deleted.

## dispose
```typescript
public async dispose?(): Promise<void>
```
This method is called when the verifier is disposed. It is optional. For example, close the Puppeteer instance.

## getStrategy
```typescript
public getStrategy() {
    return this.strategy
}
```
Returns the strategy of the verifier.

## getClaimType
```typescript
public getClaimType() {
    return this.claimType
}
```
Returns the claim type of the verifier.

## getDocumentationImages
```typescript
public getDocumentationImages() {
    return this.documentationImages
}
```
Returns the documentation images of the verifier.

## getOAuthURL
```typescript
public async getOAuthURL?(): Promise<Result<string>>
```
This method is called when the verifier is using the OAuth strategy. It is optional. It should return a URL that the user can visit to authenticate with the verifier. For example, if the verifier is a YouTube channel, this method should return a URL that the user can visit to authenticate with YouTube.

## getToken
```typescript
public async getToken?(data: any): Promise<Result<TokenResponse>>
```
This method is called when the verifier is using the OAuth strategy. It is optional. It should return a token that the verifier can use to make API calls. For example, if the verifier is a YouTube channel, this method should return a token that the verifier can use to make API calls to YouTube.

## isTokenValid
```typescript
public async isTokenValid?(challengeResponse: any, id: string): Promise<Result>
```
This method is called when the verifier is using the OAuth strategy. It is optional. It should return whether or not the token is valid. For example, if the verifier is a YouTube channel, this method should return whether or not the token is valid for the YouTube channel.

## shouldVouchFor
```typescript
public abstract shouldVouchFor(claimPointer: Models.Pointer.Pointer, claim: Protocol.Claim, challengeResponse?: string): Promise<Result>
```
This method is required for all strategies. It should return whether or not the verifier should vouch for the claim. For example, if the verifier is a YouTube channel, this method should return whether or not the YouTube channel should vouch for the claim.

## healthCheck
```typescript
public async healthCheck(): Promise<Result<any>>
```
This method is called when the verifier is being health checked. It is optional. It should return whether or not the verifier is healthy. This is done by running a test. Verifiers should be healthy but situations like API changes from the platforms can break them which this method can automatically test for.