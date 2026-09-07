---
title: Identity & Devices
sidebar_label: Identity & Devices
sidebar_position: 10
---

# Identity & Devices

Your Harbor identity is a set of cryptographic keys held on your devices,
not an account on a server. Everything you publish is signed with those
keys, which is why servers can't forge or edit your content.

## Adding a device

Use `Settings > Pair Identity` to add another device to your identity.
Your new device can get the pairing code by scanning the QR code displayed on
your existing device or by entering it manually after copying it to your
clipboard.
You will then have to compare the emoji fingerprint before approving the new
device.

## Recovering when you have no devices logged in

The preferred way to add a new device to your identity is pairing. However,
there is a backup system in case you no longer have an existing device that can
pair new devices. This may happen if you have only one device with Harbor and
its data gets cleared, or if the device malfunctions and no longer works.

A backup can be created using `Settings > Back Up Identity`. You will be given a
file to save and store securely. If you still have an older backup file and
create a new one, then you should prefer the new one since the old one may not
work anymore. Still never share any backup files, even if a newer one has been
created.

You can check your backup file in `Settings > Test Backup` to ensure that you
have created a backup successfully.

On your new device, press `I already have an identity > Recover using backup`
and select the latest backup file to add the device without relying on an
existing session.

## Choosing your servers

Settings, Configure servers lists the servers your identity publishes to.
Add servers by URL, remove ones you no longer trust, and your content syncs
to whatever set you choose. Anyone can run one; see
[Host a Server](../guides/running-a-server.md).
