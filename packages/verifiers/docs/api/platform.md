# Platform
To add a new platform, simply create a new file in the /src/platforms directory and export a Platform object. The Platform object has the following structure:

```typescript
type Platform = {
    name: string
    imageUrl: string
    platformUrl: string
    verifiers: Verifier[]
    version: number
}
```

### name
The name of the platform. This is used in the UI and in the API.

### imageUrl
The URL of the image to display for the platform. This is used in the UI.

### platformUrl
The URL of the platform. This is used in the UI and in the API. Do not include the trailing slash or https://.

### verifiers
An array of Verifier objects. Platform may support multiple types of verifiers in case of errors or other issues. One example is Instagram having an OAuth verifier and a description verifier.

### version
The version of the platform.

## Usage
```typescript
import { Platform } from '../types'

const Github: Platform = {
    name: 'Github',
    imageUrl: 'https://raw.githubusercontent.com/Donnnno/Arcticons/3f432186cbe334d5e55afa19edb5e404d18dc0be/icons/white/github.svg',
    platformUrl: 'github.com',
    verifiers: [GithubVerifier],
    version: 1,
}

exports.platform = Github
```