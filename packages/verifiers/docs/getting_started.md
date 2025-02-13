---
label: Getting Started
icon: rocket
order: 10
---

# Getting Started
!!!
If you are interested in using docker, check out the [hosting](hosting) page.
!!!
Getting started developing new polycentric verifiers or hosting the existing ones is easy. 
This guide will walk you through the process of getting the existing verifiers running locally. The [creating a verifier](creating-verifier) page contains instructions for creating a new verifier.

## Prerequisites
The following software is required to build and run the verifiers:
- [git](https://git-scm.com/)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/) or [pnpm](https://pnpm.io/)
- [node.js](https://nodejs.org/)

## Installation
First, clone the repository:
```bash
git clone https://gitlab.futo.org/videostreaming/verifiers.git
```

Then, install the submodules so that polycentric is available:
```bash
git submodule update --init --recursive
```

Then, make the polycentric repo:
```bash
cd dep
cd polycentric
make proto
```

Then, install the dependencies for the verifiers:
```bash
cd ..
cd ..
npm install # or yarn install or pnpm install
```

Finally, start the verifiers:
```bash
npm run start # or yarn start or pnpm run start
```