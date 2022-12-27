---
label: Introduction
icon: home
---

# Introduction

Polycentric is an Open-source distributed social network. Checkout our GitLab [here](https://gitlab.futo.org/polycentric/polycentric), or jump right into the [app](https://polycentric.io).

![](static/concept2.png)

## Motivation

Social media platforms such as Facebook or Twitter have become increasingly controversial due to a multitude of events in which they have been shown to cause harm to their users. One of the main criticisms of these platforms is that they are heavily centralized, meaning that a single company or organization controls all aspects of the platform, including the content that is posted, the algorithms that determine what users see, and the data that is collected about users. A number of instances have since been uncovered where mainstream platforms have allowed the manipulation of public opinion by corporate entities, various forms of private user data exploitation, and a litany of other abuses.

These platforms have been accused continually of failing to adequately protect users' privacy. It has become commonplace for social media platforms to base their entire monetization strategy on the collection of personal data generally without adequately informing users or obtaining their explicit consent. Most users are left completely unaware of the extent of the data being collected on them or how it is used. 

The recommendation algorithms used by social media platforms enable them to shape public opinion and wield significant influence over public discourse. This algorithmic curation leads to controversial echo chambers and biased content spirals that in effect hinder users from accessing a full range of viewpoints and perspectives. Centralized services bias their content in favor of certain viewpoints or perspectives by prioritizing content from mainstream sources over content from marginalized or underrepresented groups. This severely limits the information that users are able to access and perpetuates existing power imbalances.

The collection and analysis of data about users on traditional forms of social media is used time and time again as a surveillance tool for malicious actors to target vulnerable or at-risk portions of the population. Mainstream platforms turn a blind eye, or worse, overtly allow user data to be used for discrimination, surveillance, or targeted suppression.

## Polycentric

Polycentric provides an alternative to traditional social media platforms by utilizing self-sovereign identities in a distributed censorship-resistant network. Unlike centralized social media platforms, Polycentric places users and server owners in control of their personal feeds and allow them to choose curation or influence provided by various servers. Recommendation servers can be opted into by users based on their personal preferences and can be switched out with ease.

The distributed nature of Polycentric allows it to be highly resistant to most conceivable forms of censorship. If a rogue node attempts to censor messages from a particular user the platform automatically attempts to retrieve that content from a different node. If the content cannot be found on any currently active node there are visual cues that let users know that posts are missing. In this sense, the platform is highly tamper-resistant such that any tampering of messages within a user's feed is readily apparent from a user's perspective. Subtle forms of shadowbanning within users' feeds that are rampant on mainstream platforms are thus heavily disincentivized by the underlying software.

In contrast to other social media platforms, both centralized and distributed, identities on Polycentric are sovereign. There is no ability to delete a specific user from the platform as all user information is stored in a wholly distributed manner. A given user can continue to post unhindered as long as there exists at least one node on the platform allowing them to do so. Each user has full control of their own account, their personal metadata, and what they choose to post. There is no centralized control over who can or cannot post on the platform or what posts can be seen. Users of any node in the platform can choose to follow and receive content from any other user on the platform.

Polycentric does not collect personalized data profiles on its users. There currently exists no ability within the software for servers participating in the platform to collect personalized user data. Nor are servers able to perform data mining tasks aside from those which could be achieved by publicly scraping the site. Though some trivial amounts of aggregate data are required to perform basic maintenance tasks, these are periodically deleted.

Traditional forms of social media require a constant internet connection in order to access the content on their platforms. Polycentric is designed to be resilient to connectivity issues and allows a wide range of offline browsing capabilities. Users can browse their own feed or the previous history of anyone they are following without an internet connection. Polycentric also allows offline users to make posts on their feeds or react to others' posts. All offline posting is automatically synchronized with the rest of the platform upon reconnection. A core goal of the platform is to be as lightweight as possible and emphasize the needs of those who live in areas of poor or intermittent connectivity. 

## Servers

The Polycentric platform is made up of a set of distributed servers that voluntarily participate in the network. Anyone is allowed to operate their own server instance and participate in the network, and users are able to individually choose which servers they wish to connect to the network through. Server operators have the ability to curate which content is shown in their recommendations feeds and can modify only these feeds in order to protect against spam, NSFW material, or to comply with legal constraints. These specific feeds are the only material that the core protocol allows each server to curate for themselves.

## Cryptography

On Polycentric, each user has an identity secured by public-key cryptography which they fully control locally on their own device. The messages sent by a given user are cryptographically signed to ensure that each message has not been tampered with and is authentic. Cryptographic signatures, also known as digital signatures, are a common method for verifying the authenticity and integrity of messages. Any recipient of a given post can confirm that the message was actually sent by the user they were following and that it was not altered in some way before being sent.

Identities and keys used to authenticate and sign messages are controlled solely by each end-user.  The servers within the platform never have access to any of the keys controlled by users. Upon receiving new messages through the synchronization process, for each new message received the client performs authentication checks against the signatures. These checks verify the authenticity of the feed and as mentioned previously, throw up a red flag if any posted content is missing or does not have valid signatures. 

Since these keys are controlled by each user individually linking multiple devices and importing and exporting profiles can be done quickly and easily. Users on Polycentric have full control over their data and have the ability to redact any prior posts. We consider these identities to be self-sovereign identities because of the control they grant each user.

In a centralized setting, users must trust that the platform they are on will not arbitrarily delete or modify their posts. In cases where this potentially does happen on traditional social media, there is no indication that a redaction or modification of a posted message occurred. Centralized services often advertise encrypted services, but in these instances, the company themselves control users' keys.

Centralized settings also commonly make it difficult or painful to import or export profile data. To combat this issue, Polycentric attempts to provide as much cross-platform portability as possible. We intend for individuals the full flexibility to move their accounts from one platform or server to another if they so choose as opposed to being locked into one specific platform.

## Data Storage

Data on Polycentric is distributed across nodes and available from any node participating in the platform. Distributed file storage is generally defined as a process of sharing files over a network, in Polycentric this network is also trustless. Files are stored on multiple devices, rather than on a central server thus allowing users to access and download the feed content from any server. This is similar to other common peer-to-peer filesharing methods such as torrenting.

When a user begins to load a post on the platform, they have the ability to automatically connect to any of the nodes that have a copy of a given post and download it from there. This decentralized approach to file storage allows users to access posts even when some servers are unavailable or if the network is experiencing problems. Other forms of traditional social media are much less resilient to data center downtime. Distributed filesharing can also lead to significant gains in efficiency over centralized file retrieval.

## Why not use blockchain?

Immutable blockchain data structures are well-suited for certain types of secure applications such as those that involve financial transactions or the exchange of digital assets. We also applaud the work done by the blockchain community to provide sources of funding to developers and entrepreneurs who may not otherwise have access to traditional channels of funding such as bank loans or venture capital. 

However, the consensus mechanisms used to validate blockchain platforms often render them inefficient for high-speed tasks. This consensus process involves multiple nodes in a network verifying entries and agreeing on their validity before they can be added to the blockchain. This can take significant amounts of time, particularly if the network is large or if there are a high number of changes being processed simultaneously.

Even with currently established proposals to improve blockchain speed, it is still a largely incompatible solution for most applications geared toward low latency. The Polycentric architecture offers very similar guarantees to those provided by blockchains, i.e. distributed data synchronization, validation of post authenticity, and censorship detection but at a much lower computational overhead.

## Open Source 

Unlike centralized services owned by large corporations, which generally do not allow access to their codebases, Polycentric is open source. Publicly publishing code allows any technically inclined user to inspect what is running on the platform if they choose to do so. The code may be audited by any third party for errors or bugs and modifications to the code can be proposed by the community at large. Any user can run their own test instances of the code to experiment outside the main platform.

