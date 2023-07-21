import * as Base64 from '@borderless/base64';

import * as Store from './store';
import Long from 'long';
import * as Protocol from './protocol';
import * as Models from './models';
import * as MetaStore from './meta-store';
import * as Util from './util';
import * as Ranges from './ranges';
import * as PersistenceDriver from './persistence-driver';

export class SystemState {
    private _servers: Array<string>;
    private _processes: Array<Models.Process.Process>;
    private _username: string;
    private _description: string;
    private _store: string;
    private _avatar: Models.Pointer.Pointer | undefined;

    public constructor(
        servers: Array<string>,
        processes: Array<Models.Process.Process>,
        username: string,
        description: string,
        store: string,
        avatar: Models.Pointer.Pointer | undefined,
    ) {
        this._servers = servers;
        this._processes = processes;
        this._username = username;
        this._description = description;
        this._store = store;
        this._avatar = avatar;
    }

    public servers(): Array<string> {
        return this._servers;
    }

    public processes(): Array<Models.Process.Process> {
        return this._processes;
    }

    public username(): string {
        return this._username;
    }

    public description(): string {
        return this._description;
    }

    public store(): string {
        return this._store;
    }

    public avatar(): Models.Pointer.Pointer | undefined {
        return this._avatar;
    }
}

export function protoSystemStateToSystemState(
    proto: Protocol.StorageTypeSystemState,
): SystemState {
    const servers = [];

    for (const item of proto.crdtSetItems) {
        if (
            item.contentType.equals(Models.ContentType.ContentTypeServer) &&
            item.operation === Protocol.LWWElementSet_Operation.ADD
        ) {
            servers.push(Util.decodeText(item.value));
        }
    }

    const processes = [];

    for (const process of proto.processes) {
        processes.push(Models.Process.fromProto(process));
    }

    let username = '';
    let description = '';
    let store = '';
    let avatar = undefined;

    for (const item of proto.crdtItems) {
        if (item.contentType.equals(Models.ContentType.ContentTypeUsername)) {
            username = Util.decodeText(item.value);
        } else if (
            item.contentType.equals(Models.ContentType.ContentTypeDescription)
        ) {
            description = Util.decodeText(item.value);
        } else if (
            item.contentType.equals(Models.ContentType.ContentTypeStore)
        ) {
            store = Util.decodeText(item.value);
        } else if (
            item.contentType.equals(Models.ContentType.ContentTypeAvatar)
        ) {
            avatar = Models.Pointer.fromProto(
                Protocol.Pointer.decode(item.value),
            );
        }
    }

    return new SystemState(
        servers,
        processes,
        username,
        description,
        store,
        avatar,
    );
}

export class ProcessHandle {
    private _processSecret: Models.ProcessSecret.ProcessSecret;
    private _store: Store.Store;
    private _system: Models.PublicKey.PublicKey;
    private _listener:
        | ((signedEvent: Models.SignedEvent.SignedEvent) => void)
        | undefined;
    private _addressHints: Map<Models.PublicKey.PublicKeyString, Set<string>>;

    private constructor(
        store: Store.Store,
        processSecret: Models.ProcessSecret.ProcessSecret,
        system: Models.PublicKey.PublicKey,
    ) {
        this._store = store;
        this._processSecret = processSecret;
        this._system = system;
        this._listener = undefined;
        this._addressHints = new Map();
    }

    public addAddressHint(
        system: Models.PublicKey.PublicKey,
        server: string,
    ): void {
        const systemString = Models.PublicKey.toString(system);

        let hintsForSystem = this._addressHints.get(systemString);

        if (hintsForSystem === undefined) {
            hintsForSystem = new Set();

            this._addressHints.set(systemString, hintsForSystem);
        }

        hintsForSystem.add(server);
    }

    public getAddressHints(system: Models.PublicKey.PublicKey): Set<string> {
        const systemString = Models.PublicKey.toString(system);

        const hintsForSystem = this._addressHints.get(systemString);

        if (hintsForSystem === undefined) {
            return new Set();
        }

        return hintsForSystem;
    }

    public processSecret(): Models.ProcessSecret.ProcessSecret {
        return this._processSecret;
    }

    public system(): Models.PublicKey.PublicKey {
        return this._system;
    }

    public process(): Models.Process.Process {
        return this._processSecret.process;
    }

    public store(): Store.Store {
        return this._store;
    }

    public setListener(
        listener: (signedEvent: Models.SignedEvent.SignedEvent) => void,
    ): void {
        this._listener = listener;
    }

    public static async load(store: Store.Store): Promise<ProcessHandle> {
        const processSecret = await store.getProcessSecret();

        return new ProcessHandle(
            store,
            processSecret,
            await Models.PrivateKey.derivePublicKey(processSecret.system),
        );
    }

    public async post(
        content: string,
        image?: Models.Pointer.Pointer,
        reference?: Protocol.Reference,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypePost,
            Protocol.Post.encode({
                content: content,
                image: image,
            }).finish(),
            undefined,
            undefined,
            reference ? [reference] : [],
        );
    }

    public async opinion(
        subject: Protocol.Reference,
        opinion: Models.Opinion.Opinion,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeOpinion,
            new Uint8Array(),
            undefined,
            {
                value: opinion,
                unixMilliseconds: Long.fromNumber(Date.now(), true),
            },
            [subject],
        );
    }

    private async setCRDTItem(
        contentType: Models.ContentType.ContentType,
        value: Uint8Array,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            contentType,
            new Uint8Array(),
            undefined,
            {
                value: value,
                unixMilliseconds: Long.fromNumber(Date.now(), true),
            },
            [],
        );
    }

    public async setUsername(
        username: string,
    ): Promise<Models.Pointer.Pointer> {
        return await this.setCRDTItem(
            Models.ContentType.ContentTypeUsername,
            Util.encodeText(username),
        );
    }

    public async setStore(storeLink: string): Promise<Models.Pointer.Pointer> {
        return await this.setCRDTItem(
            Models.ContentType.ContentTypeStore,
            Util.encodeText(storeLink),
        );
    }

    public async setDescription(
        description: string,
    ): Promise<Models.Pointer.Pointer> {
        return await this.setCRDTItem(
            Models.ContentType.ContentTypeDescription,
            Util.encodeText(description),
        );
    }

    public async setAvatar(
        avatar: Models.Pointer.Pointer,
    ): Promise<Models.Pointer.Pointer> {
        return await this.setCRDTItem(
            Models.ContentType.ContentTypeAvatar,
            Protocol.Pointer.encode(avatar).finish(),
        );
    }

    public async addServer(server: string): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeServer,
            new Uint8Array(),
            {
                operation: Protocol.LWWElementSet_Operation.ADD,
                value: Util.encodeText(server),
                unixMilliseconds: Long.fromNumber(Date.now(), true),
            },
            undefined,
            [],
        );
    }

    public async removeServer(server: string): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeServer,
            new Uint8Array(),
            {
                operation: Protocol.LWWElementSet_Operation.REMOVE,
                value: Util.encodeText(server),
                unixMilliseconds: Long.fromNumber(Date.now(), true),
            },
            undefined,
            [],
        );
    }

    public async vouch(
        pointer: Models.Pointer.Pointer,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeVouch,
            new Uint8Array(),
            undefined,
            undefined,
            [Models.pointerToReference(pointer)],
        );
    }

    public async claim(
        claimValue: Protocol.Claim,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeClaim,
            Protocol.Claim.encode(claimValue).finish(),
            undefined,
            undefined,
            [],
        );
    }

    public async delete(
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<Models.Pointer.Pointer | undefined> {
        const signedEvent = await this._store.getSignedEvent(
            this._system,
            process,
            logicalClock,
        );

        if (!signedEvent) {
            return undefined;
        }

        const event = Models.Event.fromBuffer(signedEvent.event);

        return await this.publish(
            Models.ContentType.ContentTypeDelete,
            Protocol.Delete.encode({
                process: process,
                logicalClock: logicalClock,
                indices: event.indices,
                unixMilliseconds: event.unixMilliseconds,
                contentType: event.contentType,
            }).finish(),
            undefined,
            undefined,
            [],
        );
    }

    public async publishBlob(
        mime: string,
        content: Uint8Array,
    ): Promise<Models.Pointer.Pointer> {
        const meta = await this.publish(
            Models.ContentType.ContentTypeBlobMeta,
            Protocol.BlobMeta.encode({
                sectionCount: new Long(1, 0, true),
                mime: mime,
            }).finish(),
            undefined,
            undefined,
            [],
        );

        await this.publish(
            Models.ContentType.ContentTypeBlobSection,
            Protocol.BlobSection.encode({
                metaPointer: meta.logicalClock,
                content: content,
            }).finish(),
            undefined,
            undefined,
            [],
        );

        return meta;
    }

    public async loadBlob(
        pointer: Models.Pointer.Pointer,
    ): Promise<Models.Blob | undefined> {
        const meta = await (async () => {
            const signedEvent = await this._store.getSignedEvent(
                pointer.system,
                pointer.process,
                pointer.logicalClock,
            );

            if (!signedEvent) {
                return undefined;
            }

            const event = Models.Event.fromBuffer(signedEvent.event);

            if (
                !event.contentType.equals(
                    Models.ContentType.ContentTypeBlobMeta,
                )
            ) {
                return undefined;
            }

            return Protocol.BlobMeta.decode(event.content);
        })();

        if (!meta) {
            return undefined;
        }

        const section = await (async () => {
            const signedEvent = await this._store.getSignedEvent(
                pointer.system,
                pointer.process,
                pointer.logicalClock.add(Long.UONE),
            );

            if (!signedEvent) {
                return undefined;
            }

            const event = Models.Event.fromBuffer(signedEvent.event);

            if (
                !event.contentType.equals(
                    Models.ContentType.ContentTypeBlobSection,
                )
            ) {
                return undefined;
            }

            return Protocol.BlobSection.decode(event.content);
        })();

        if (!section) {
            return undefined;
        }

        return new Models.Blob(meta.mime, section.content);
    }

    public async loadSystemState(
        system: Models.PublicKey.PublicKey,
    ): Promise<SystemState> {
        const protoSystemState = await this._store.getSystemState(system);

        const systemState = protoSystemStateToSystemState(protoSystemState);

        const addressHints = this.getAddressHints(system);

        for (const address1 of addressHints) {
            let found = false;

            for (const address2 of systemState.servers()) {
                if (address1 === address2) {
                    found = true;
                    break;
                }
            }

            if (found === false) {
                systemState.servers().push(address1);
            }
        }

        return systemState;
    }

    async publish(
        contentType: Models.ContentType.ContentType,
        content: Uint8Array,
        lwwElementSet: Protocol.LWWElementSet | undefined,
        lwwElement: Protocol.LWWElement | undefined,
        references: Array<Protocol.Reference>,
    ): Promise<Models.Pointer.Pointer> {
        const processState = await this._store.getProcessState(
            this._system,
            this._processSecret.process,
        );

        if (processState.indices === undefined) {
            throw new Error('expected indices');
        }

        const event = Models.Event.fromProto({
            system: this._system,
            process: this._processSecret.process,
            logicalClock: processState.logicalClock.add(Long.UONE).toUnsigned(),
            contentType: contentType,
            content: content,
            vectorClock: { logicalClocks: [] },
            lwwElementSet: lwwElementSet,
            lwwElement: lwwElement,
            references: references,
            indices: processState.indices,
            unixMilliseconds: Long.fromNumber(Date.now(), true),
        });

        const eventBuffer = Protocol.Event.encode(event).finish();

        const signedEvent = Models.SignedEvent.fromProto({
            signature: await Models.PrivateKey.sign(
                this._processSecret.system,
                eventBuffer,
            ),
            event: eventBuffer,
        });

        return await this.ingest(signedEvent);
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Models.Pointer.Pointer> {
        const event = Models.Event.fromProto(
            Protocol.Event.decode(signedEvent.event),
        );

        const systemState = await this._store.getSystemState(event.system);

        const processState = await this._store.getProcessState(
            event.system,
            event.process,
        );

        const actions = [];

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteProto = Protocol.Delete.decode(event.content);

            if (!deleteProto.process) {
                throw new Error('delete expected process');
            }

            const deleteProcess = Models.Process.fromProto(deleteProto.process);

            let deleteProcessState = processState;

            if (!Models.Process.equal(event.process, deleteProcess)) {
                deleteProcessState = await this._store.getProcessState(
                    event.system,
                    deleteProcess,
                );
            }

            Ranges.insert(deleteProcessState.ranges, deleteProto.logicalClock);

            actions.push(
                this._store.putTombstone(
                    event.system,
                    deleteProcess,
                    deleteProto.logicalClock,
                    await Models.signedEventToPointer(signedEvent),
                ),
            );
        }

        actions.push(
            this._store.putIndexSystemContentTypeUnixMillisecondsProcess(event),
        );

        updateSystemState(systemState, event);
        updateProcessState(processState, event);

        actions.push(this._store.putSystemState(event.system, systemState));

        actions.push(
            this._store.putProcessState(
                event.system,
                event.process,
                processState,
            ),
        );

        actions.push(
            this._store.putEvent(
                event.system,
                event.process,
                event.logicalClock,
                signedEvent,
            ),
        );

        await this._store.level.batch(actions);

        if (this._listener !== undefined) {
            this._listener(signedEvent);
        }

        return await Models.signedEventToPointer(signedEvent);
    }
}

export async function createProcessHandle(
    metaStore: MetaStore.IMetaStore,
): Promise<ProcessHandle> {
    const privateKey = Models.PrivateKey.random();
    const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
    const process = Models.Process.random();

    const level = await metaStore.openStore(publicKey, 0);

    const processSecret = Models.ProcessSecret.fromProto({
        system: privateKey,
        process: process,
    });

    const store = new Store.Store(level);

    await store.setProcessSecret(processSecret);

    await metaStore.setStoreReady(publicKey, 0);

    return ProcessHandle.load(store);
}

export async function createProcessHandleFromKey(
    metaStore: MetaStore.IMetaStore,
    privateKey: Models.PrivateKey.PrivateKey,
): Promise<ProcessHandle> {
    const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
    const process = Models.Process.random();
    const level = await metaStore.openStore(publicKey, 0);

    const processSecret = Models.ProcessSecret.fromProto({
        system: privateKey,
        process: process,
    });

    const store = new Store.Store(level);
    await store.setProcessSecret(processSecret);
    await metaStore.setStoreReady(publicKey, 0);
    return ProcessHandle.load(store);
}

export function updateSystemState(
    state: Protocol.StorageTypeSystemState,
    event: Models.Event.Event,
): void {
    {
        const lwwElementSet = event.lwwElementSet;

        if (lwwElementSet) {
            let found: Protocol.StorageTypeCRDTSetItem | undefined = undefined;

            for (const item of state.crdtSetItems) {
                if (
                    item.contentType.equals(event.contentType) &&
                    Util.buffersEqual(item.value, lwwElementSet.value)
                ) {
                    found = item;
                    break;
                }
            }

            if (
                found &&
                found.unixMilliseconds < lwwElementSet.unixMilliseconds
            ) {
                found.unixMilliseconds = lwwElementSet.unixMilliseconds;
                found.operation = lwwElementSet.operation;
            } else {
                state.crdtSetItems.push({
                    contentType: event.contentType,
                    value: lwwElementSet.value,
                    unixMilliseconds: lwwElementSet.unixMilliseconds,
                    operation: lwwElementSet.operation,
                });
            }
        }
    }

    {
        const lwwElement = event.lwwElement;

        if (lwwElement) {
            let found: Protocol.StorageTypeCRDTItem | undefined = undefined;

            for (const item of state.crdtItems) {
                if (item.contentType.equals(event.contentType)) {
                    found = item;
                    break;
                }
            }

            if (found && found.unixMilliseconds < lwwElement.unixMilliseconds) {
                found.unixMilliseconds = lwwElement.unixMilliseconds;
                found.value = lwwElement.value;
            } else {
                state.crdtItems.push({
                    contentType: event.contentType,
                    value: lwwElement.value,
                    unixMilliseconds: lwwElement.unixMilliseconds,
                });
            }
        }
    }

    {
        let foundProcess = false;

        for (const rawProcess of state.processes) {
            if (
                Models.Process.equal(
                    Models.Process.fromProto(rawProcess),
                    event.process,
                )
            ) {
                foundProcess = true;
                break;
            }
        }

        if (!foundProcess) {
            state.processes.push(event.process);
        }
    }
}

function updateProcessState(
    state: Protocol.StorageTypeProcessState,
    event: Models.Event.Event,
): void {
    if (event.logicalClock.compare(state.logicalClock) === 1) {
        state.logicalClock = event.logicalClock;
    }

    if (state.indices === undefined) {
        throw new Error('expected indices');
    }

    Ranges.insert(state.ranges, event.logicalClock);

    {
        let foundIndex = false;

        for (const index of state.indices.indices) {
            if (index.indexType.equals(event.contentType)) {
                foundIndex = true;

                if (event.logicalClock.compare(index.logicalClock) === 1) {
                    index.logicalClock = event.logicalClock;
                }
            }
        }

        if (!foundIndex) {
            state.indices.indices.push({
                indexType: event.contentType,
                logicalClock: event.logicalClock,
            });
        }
    }
}

export async function makeEventLink(
    handle: ProcessHandle,
    system: Models.PublicKey.PublicKey,
    event: Models.Pointer.Pointer,
): Promise<string> {
    const state = await handle.loadSystemState(system);

    return makeEventLinkSync(event, state.servers());
}

export function makeEventLinkSync(
    event: Models.Pointer.Pointer,
    servers: Array<string>,
): string {
    return Base64.encodeUrl(
        Protocol.URLInfo.encode({
            urlType: Models.URLInfo.URLInfoTypeEventLink,
            body: Protocol.URLInfoEventLink.encode({
                system: event.system,
                process: event.process,
                logicalClock: event.logicalClock,
                servers: servers,
            }).finish(),
        }).finish(),
    );
}

export async function makeSystemLink(
    handle: ProcessHandle,
    system: Models.PublicKey.PublicKey,
): Promise<string> {
    const state = await handle.loadSystemState(system);

    return makeSystemLinkSync(system, state.servers());
}

export function makeSystemLinkSync(
    system: Models.PublicKey.PublicKey,
    servers: Array<string>,
): string {
    return Base64.encodeUrl(
        Protocol.URLInfo.encode({
            urlType: Models.URLInfo.URLInfoTypeSystemLink,
            body: Protocol.URLInfoSystemLink.encode({
                system: system,
                servers: servers,
            }).finish(),
        }).finish(),
    );
}

export async function createTestProcessHandle(): Promise<ProcessHandle> {
    return await createProcessHandle(
        await MetaStore.createMetaStore(
            PersistenceDriver.createPersistenceDriverMemory(),
        ),
    );
}
