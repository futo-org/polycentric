# Result
The Result class is used to return the result of a verifier method. It is used frequently across the codebase. Result is a generic class taking in a value of type T

## Constructor
```typescript
constructor(success: boolean, error: ResultError, value: T)

type ResultError = {
    message: string
    extendedMessage?: string
    statusCode?: number
}
```

### success
Whether or not the result was successful.

### error
The error that occurred.

### value
The value of the result.

## Usage
```typescript
Result.ok('The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization')
```
Ok results are used to return a successful result. They include a value of type T.

```typescript
Result.err({
    message: 'Unable to find your account',
    extendedMessage: `Failed to get Profile page (${profileResult.status}): '${
        profileResult.statusText
    } (${profileResult.toString()})'.`,
})
```
Error results are used to return an unsuccessful result. They include an error of type ResultError. This error includes a short message and a long message and an optional status code. The short message is displayed to the user. The long message is displayed to the developer. The status code is used to determine the status of the error.