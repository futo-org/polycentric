---
title: Declaring Your Application
sidebar_label: Declaring Your Application
sidebar_position: 4
---

# Declaring Your Application

Every event carries an optional [`Application`](../protocol/data-model.md#application)
message naming the app that created it. If you are building something that writes
events, set it on every event you sign. Readers use it to show where a post came from,
and server operators use it to see which apps their users run.

The message is inside the signed event bytes, so it is the author's claim about their
own software. Servers do not fill it in, and it cannot be changed once signed.

## What to put in each field

```protobuf
message Application {
  string name = 1;
  string id = 2;
  string version = 3;
  string url = 4;
}
```

**`name`** is the product name people recognise, such as `Harbor`. Keep it the same
across platforms and build variants. Clients display it verbatim, so keep it short.

**`id`** is a reverse-DNS identifier for the build, such as `org.futo.polycentric`. On
Android and iOS use the installed package or bundle identifier. Give each distribution
its own id where they differ in practice, for example a dev build, a store build, or a
web build, so operators can tell them apart. Keep it stable across versions. Never
reuse another app's id.

**`version`** is the version people see in your app or its store listing, such as
`1.2.0`. Read it from the installed binary rather than hardcoding it.

**`url`** is the website for your app, such as `https://harbor.social`. It must start
with `http://` or `https://`. Clients turn the app name into a link to this address, and
ignore anything that is not a web URL. Leave it empty if you have no site.

Leave the whole message unset only when your software genuinely cannot say what it
is. Do not set it to placeholder values.

## Setting it with the SDKs

The SDKs stamp the application on every event they build once you pass it at
construction time.

### JavaScript

```ts
import { PolycentricClient } from '@polycentric/js-core';

const client = await PolycentricClient.create({
  core,
  storageDriver,
  filestoreDriver,
  application: {
    name: 'My App',
    id: 'com.example.myapp',
    version: '1.2.0',
    url: 'https://myapp.example.com',
  },
});
```

### React Native

```ts
import { createPolycentricClient } from '@polycentric/react-native';
import * as Application from 'expo-application';

const client = await createPolycentricClient({
  application: {
    name: 'My App',
    id: Application.applicationId ?? 'com.example.myapp.web',
    version: Application.nativeApplicationVersion ?? '',
    url: 'https://myapp.example.com',
  },
});
```

`expo-application` reports no id or version on the web, so fall back to values you
embed in your build. Harbor's web image serves every environment, so it derives the
web id from an `EXPO_PUBLIC_APP_VARIANT` runtime variable.

### Kotlin

```kotlin
val client = PolycentricClient(
    core = core,
    storageDriver = storageDriver,
    filestore = filestore,
    application = Application(
        name = "My App",
        id = "com.example.myapp",
        version = BuildConfig.VERSION_NAME,
        url = "https://myapp.example.com",
    ),
)
```

### Building events yourself

If you construct `Event` messages directly, set `application` before serializing and
signing. It is field 9 on `Event`. Anything set after signing is discarded, because the
server stores the exact bytes that were signed.

## What Harbor sends

| Build | `id` |
|---|---|
| Android APK | `org.futo.polycentric` |
| Android Play Store | `org.futo.polycentric.store` |
| iOS | `org.futo.polycentric` |
| Web | `org.futo.polycentric.web` |

Dev and staging builds insert `.dev` or `.staging` before any `.store` or `.web`
suffix. The name is always `Harbor` and the url is `https://harbor.social`. Release
builds carry the release version; other builds carry the next patch version plus the
commit, e.g. `1.2.1+ab12cd34`.

## How it is used

Harbor shows "Posted with" and the app name above any post whose id does not start
with `org.futo.polycentric`, linking the name to the url when there is one. Servers
record which application each event came from so operators can query it.
