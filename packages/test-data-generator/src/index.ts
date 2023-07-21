import * as Core from '@polycentric/polycentric-core';

const SERVER = 'http://127.0.0.1:8081';

async function createProcessHandle(): Promise<Core.ProcessHandle.ProcessHandle> {
    const handle = await Core.ProcessHandle.createProcessHandle(
        await Core.MetaStore.createMetaStore(
            Core.PersistenceDriver.createPersistenceDriverMemory(),
        ),
    );

    await handle.addServer(SERVER);

    return handle;
}

async function fullSync(handle: Core.ProcessHandle.ProcessHandle) {
    while (
        await Core.Synchronization.backFillServers(handle, handle.system())
    ) {}
}

async function scenarioLargeNumberOfClaims() {
    const s1p1 = await createProcessHandle();

    await s1p1.setUsername('scenarioLargeNumberOfClaims');

    for (let i = 0; i < 1000; i++) {
        await s1p1.claim(Core.Models.claimGeneric(i.toString()));
    }

    await fullSync(s1p1);

    console.log(
        'scenarioLargeNumberOfClaims: ',
        await Core.ProcessHandle.makeSystemLink(s1p1, s1p1.system()),
    );
}

async function scenarioEveryClaimType() {
    const s1p1 = await createProcessHandle();

    await s1p1.setUsername('scenarioEveryClaimType subject');

    const claims = [
        await s1p1.claim(Core.Models.claimHackerNews('eron_wolf')),
        await s1p1.claim(Core.Models.claimYouTube('@FUTOTECH')),
        await s1p1.claim(Core.Models.claimOdysee('@FUTO')),
        await s1p1.claim(Core.Models.claimRumble('rossmanngroup')),
        await s1p1.claim(Core.Models.claimTwitter('FUTO_Tech')),
        await s1p1.claim(
            Core.Models.claimBitcoin('1EaEv8DBeFfg6fE6BimEmvEFbYLkhpcvhj'),
        ),
        await s1p1.claim(Core.Models.claimGeneric('hello world')),
        await s1p1.claim(Core.Models.claimDiscord('thekinocorner')),
        await s1p1.claim(Core.Models.claimInstagram('@the_kino_corner')),
        await s1p1.claim(Core.Models.claimGitHub('futo-org')),
        await s1p1.claim(Core.Models.claimMinds('futo')),
        await s1p1.claim(Core.Models.claimPatreon('thekinocorner')),
        await s1p1.claim(Core.Models.claimSubstack('astralcodexten')),
        await s1p1.claim(Core.Models.claimTwitch('thekinocorner')),
        await s1p1.claim(Core.Models.claimWebsite('futo.org')),
        await s1p1.claim(Core.Models.claimURL('https://futo.org/grants')),
    ];

    await fullSync(s1p1);

    const s2p1 = await createProcessHandle();

    await s2p1.setUsername('scenarioEveryClaimType authority');

    for (const claim of claims) {
        await s1p1.vouch(claim);
    }

    console.log(
        'scenarioEveryClaimType subject: ',
        await Core.ProcessHandle.makeSystemLink(s1p1, s1p1.system()),
    );

    console.log(
        'scenarioEveryClaimType authority: ',
        await Core.ProcessHandle.makeSystemLink(s2p1, s2p1.system()),
    );
}

async function main() {
    await scenarioLargeNumberOfClaims();
    await scenarioEveryClaimType();
}

main();
