import * as DB from './db';
import * as Protocol from './protocol';
import * as Ingest from './ingest';
import * as Keys from './keys';

export async function migrateCopyEvents(
    from: DB.PolycentricState,
    to: DB.PolycentricState,
): Promise<void> {
    const identity = await DB.tryLoadKey(from.level, Keys.IDENTITY_KEY);

    if (identity == undefined) {
        throw new Error('tried to migrate from state without identity');
    }

    await to.level.put(Keys.IDENTITY_KEY, identity);

    for await (const storeItemBinary of from.levelEvents.values()) {
        const storeItem = Protocol.StorageTypeEvent.decode(storeItemBinary);

        if (storeItem.event !== undefined) {
            await Ingest.levelSaveEvent(to, storeItem.event);
        }
    }
}
