---
label: Troubleshooting & FAQ
icon: question
---

# Troubleshooting & FAQ

#### Why aren't some of the platforms showing up on the Harbor app when I have it connected to my self-hosted verifier server?

Verifiers automatically check wether they are working at a fixed interval. If a verifier is broken and it is the only verifier
for a given platform, it will not show up in the Harbor app. 

For OAuth verifiers, this is usually due to missing [environment variables](environment_variables).

#### What's the difference between a Platform and a Verifier?

A platform is a website or service such as Spotify, Instagram, or X/Twitter. A verifier is a piece of code that verifies that a 
person owns an account on a platform

#### Why is this useful?

This is useful as it provides a non-centralized way to associate multiple online identities with each other. This helps users maintain
a soverign digitial identity. For example, our app GrayJay uses this to associate all of a creator's channels with one Harbor profile, 
improving discoverability of this creator across platforms.

#### What stops a bad actor from verifying everything no matter what?

For a verification to be trusted by you, you must trust the verifier that issued the verification. This is handled within the Harbor app and website
so that it will only show a check mark on a verificaiton if the aforementioned condition is met. This is a [Web of Trust](https://en.wikipedia.org/wiki/Web_of_trust) model.

#### What are the different types of verifiers?

As verifiers are able to be created by anyone, verifiers can use any verification 'stragegy' to verify that you own an account. The strategies that
we anticapate being popular are below (however, you can use an arbitrary string for strategy):

```typescript
export enum Strategy {
    OAuth = 'OAuth', // Using OAuth
    Description = 'Description', // Checking a user's profile description
    Message = 'Message', // Sending a message with a code to the user's account
    Cryptographic = 'Cryptographic', // Having the user sign an arbitrary string (useful for cryptocurrency wallet validation)
}
```

There are some provided utility classes associated with the above strategeriegies that help with making different types of verifiers. These are discussed
[here](creating-verifier/#writing-a-verifier-using-utility-classesfunctions). 

#### Can I create my own Verifier?

Yes! Follow the instructions in [creating a verifier](creating-verifier) to get started!

#### Do I need to own/work at a platform to make a verifier for them?

No, you can write a verifier for any platform you like.

#### Can my verifier become one of the pre-installed verifiers?

You may submit a PR to the [verifiers GitLab repository](https://gitlab.futo.org/videostreaming/verifiers) requesting that your verifier be made one of the default ones.

#### Do I need to get approval from anyone to make a verifier?

Ideally, no. However if you are creating a verifier for a platform that is not defined in the Polycentric protocol, you must get a PR approved & merged adding it to the
protocol. This is a simple and easy process that shouldn't take long. We are working on removing this requirement.

#### Why should I host my own verifier server? 

Hosting your own verifier server helps to reduce dependence on a single or small set of resources. If everyone is using the same verification server, the organization or individual
running it could shut it down and make it so that people can't get verified in a trusted manner until another verification server became widely trusted.
