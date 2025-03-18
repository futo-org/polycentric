import * as MetaStore from './meta-store';
import * as PersistenceDriver from './persistence-driver';
import * as Models from './models';
import * as Util from './util';

async function generateTestPublicKey(): Promise<Models.PublicKey.PublicKey> {
  const privateKey = Models.PrivateKey.random();
  return await Models.PrivateKey.derivePublicKey(privateKey);
}

async function createMemoryMetaStore(): Promise<MetaStore.IMetaStore> {
  const persistenceDriver = PersistenceDriver.createPersistenceDriverMemory();
  return await MetaStore.createMetaStore(persistenceDriver);
}

describe('metaStore', () => {
  test('no active store', async () => {
    const metaStore = await createMemoryMetaStore();
    expect(await metaStore.getActiveStore()).toStrictEqual(undefined);
  });

  test('open and delete store', async () => {
    const TEST_KEY = new Uint8Array([1]);
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    const s1Store = await metaStore.openStore(s1, 0);
    await s1Store.put(TEST_KEY, Util.encodeText('old'));
    await metaStore.deleteStore(s1, 0);
    const s1StorePrime = await metaStore.openStore(s1, 0);
    expect(
      await PersistenceDriver.tryLoadKey(s1StorePrime, TEST_KEY),
    ).toStrictEqual(undefined);
  });

  test('set / unset active store', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    await metaStore.openStore(s1, 0);
    await metaStore.setActiveStore(s1, 0);
    expect(await metaStore.getActiveStore()).toStrictEqual({
      system: s1,
      version: 0,
      ready: false,
    });
    await metaStore.unsetActiveStore();
    expect(await metaStore.getActiveStore()).toStrictEqual(undefined);
  });

  test('replace active store', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    const s2 = await generateTestPublicKey();
    await metaStore.openStore(s1, 0);
    await metaStore.openStore(s2, 0);
    await metaStore.setActiveStore(s1, 0);
    await metaStore.setActiveStore(s2, 0);
    expect(await metaStore.getActiveStore()).toStrictEqual({
      system: s2,
      version: 0,
      ready: false,
    });
  });

  test('delete active store', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    await metaStore.openStore(s1, 0);
    await metaStore.setActiveStore(s1, 0);
    await metaStore.deleteStore(s1, 0);
    expect(await metaStore.getActiveStore()).toStrictEqual(undefined);
  });

  test('list stores empty', async () => {
    const metaStore = await createMemoryMetaStore();
    expect(await metaStore.listStores()).toStrictEqual([]);
  });

  test('list stores', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    const s2 = await generateTestPublicKey();
    await metaStore.openStore(s1, 5);
    await metaStore.openStore(s2, 7);
    expect(
      Util.areSetsEqual(
        new Set(await metaStore.listStores()),
        new Set([
          {
            system: s1,
            version: 5,
            ready: false,
          },
          {
            system: s2,
            version: 7,
            ready: false,
          },
        ]),
        MetaStore.storeInfoEqual,
      ),
    ).toStrictEqual(true);
  });

  test('list stores deleted', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    await metaStore.openStore(s1, 0);
    await metaStore.deleteStore(s1, 0);
    expect(await metaStore.listStores()).toStrictEqual([]);
  });

  test('set store ready', async () => {
    const metaStore = await createMemoryMetaStore();
    const s1 = await generateTestPublicKey();
    await metaStore.openStore(s1, 0);
    await metaStore.setActiveStore(s1, 0);
    await metaStore.setStoreReady(s1, 0);
    expect(await metaStore.getActiveStore()).toStrictEqual({
      system: s1,
      version: 0,
      ready: true,
    });
  });
});
