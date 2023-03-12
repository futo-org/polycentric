import * as Store from './store';

import * as Base64 from '@borderless/base64';
import Long from 'long';

import * as Protocol from './protocol';
import * as Models from './models';
import * as PersistenceDriver from './persistence-driver';
import * as Ed from '@noble/ed25519';
import * as MetaStore from './meta-store';
import * as Util from './util';
import * as Ranges from './ranges';

export class SystemState {
    private _servers: Array<string>;
    private _processes: Array<Models.Process.Process>;
    private _username: string;
    private _description: string;
    private _avatar: Models.Pointer.Pointer | undefined;

    public constructor(
        servers: Array<string>,
        processes: Array<Models.Process.Process>,
        username: string,
        description: string,
        avatar: Models.Pointer.Pointer | undefined,
    ) {
        this._servers = servers;
        this._processes = processes;
        this._username = username;
        this._description = description;
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

    public avatar(): Models.Pointer.Pointer | undefined {
        return this._avatar;
    }
}

function protoSystemStateToSystemState(
    proto: Protocol.StorageTypeSystemState,
): SystemState {
    const servers = [];

    for (const item of proto.crdtSetItems) {
        if (
            item.contentType.equals(
                Models.ContentType.ContentTypeServer,
            ) &&
            item.operation == Protocol.LWWElementSet_Operation.ADD
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
    let avatar = undefined;

    for (const item of proto.crdtItems) {
        if (
            item.contentType.equals(
                Models.ContentType.ContentTypeUsername,
            )
        ) {
            username = Util.decodeText(item.value);
        } else if (
            item.contentType.equals(
                Models.ContentType.ContentTypeDescription,
            )
        ) {
            description = Util.decodeText(item.value);
        } else if (
            item.contentType.equals(
                Models.ContentType.ContentTypeAvatar,
            )
        ) {
            avatar = Models.Pointer.fromProto(
                Protocol.Pointer.decode(item.value),
            );
        }
    }

    return new SystemState(servers, processes, username, description, avatar);
}

export class ProcessHandle {
    private _processSecret: Models.ProcessSecret.ProcessSecret;
    private _store: Store.Store;
    private _system: Models.PublicKey.PublicKey;
    private _listener:
        ((signedEvent: Models.SignedEvent.SignedEvent) => void) | undefined;

    private constructor(
        store: Store.Store,
        processSecret: Models.ProcessSecret.ProcessSecret,
        system: Models.PublicKey.PublicKey,
    ) {
        this._store = store;
        this._processSecret = processSecret;
        this._system = system;
        this._listener = undefined;
    }

    public system(): Models.PublicKey.PublicKey {
        return this._system;
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

    public async post(content: string): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypePost,
            Protocol.Post.encode({
                content: content,
            }).finish(),
            undefined,
            undefined,
            [],
        );
    }

    public async setUsername(
        username: string,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeUsername,
            new Uint8Array(),
            undefined,
            new Models.LWWElement(
                Util.encodeText(username),
                Long.fromNumber(Date.now(), true),
            ),
            [],
        );
    }

    public async setDescription(
        description: string,
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeDescription,
            new Uint8Array(),
            undefined,
            new Models.LWWElement(
                Util.encodeText(description),
                Long.fromNumber(Date.now(), true),
            ),
            [],
        );
    }

    public async setAvatar(
        avatar: Models.Pointer.Pointer
    ): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeAvatar,
            new Uint8Array(),
            undefined,
            new Models.LWWElement(
                Protocol.Pointer.encode(avatar).finish(),
                Long.fromNumber(Date.now(), true),
            ),
            [],
        );
    }

    public async addServer(server: string): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeServer,
            new Uint8Array(),
            new Models.LWWElementSet(
                Models.LWWElementSetOperation.Add,
                Util.encodeText(server),
                Long.fromNumber(Date.now(), true),
            ),
            undefined,
            [],
        );
    }

    public async removeServer(server: string): Promise<Models.Pointer.Pointer> {
        return await this.publish(
            Models.ContentType.ContentTypeServer,
            new Uint8Array(),
            new Models.LWWElementSet(
                Models.LWWElementSetOperation.Remove,
                Util.encodeText(server),
                Long.fromNumber(Date.now(), true),
            ),
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

        const event = Models.eventFromProtoBuffer(signedEvent.event);

        return await this.publish(
            Models.ContentType.ContentTypeDelete,
            Protocol.Delete.encode({
                process: process, 
                logicalClock: logicalClock,
                indices: {
                    indices: event.indices(),
                },
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

            const event = Models.eventFromProtoBuffer(signedEvent.event);

            if (
                !event
                    .contentType()
                    .equals(Models.ContentType.ContentTypeBlobMeta)
            ) {
                return undefined;
            }

            return Protocol.BlobMeta.decode(event.content());
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

            const event = Models.eventFromProtoBuffer(signedEvent.event);

            if (
                !event
                    .contentType()
                    .equals(Models.ContentType.ContentTypeBlobSection)
            ) {
                return undefined;
            }

            return Protocol.BlobSection.decode(event.content());
        })();

        if (!section) {
            return undefined;
        }

        return new Models.Blob(meta.mime, section.content);
    }

    public async loadSystemState(
        system: Models.PublicKey.PublicKey,
    ): Promise<SystemState> {
        const systemState = await this._store.getSystemState(system);

        return protoSystemStateToSystemState(systemState);
    }

    async publish(
        contentType: Models.ContentType.ContentType,
        content: Uint8Array,
        lwwElementSet: Models.LWWElementSet | undefined,
        lwwElement: Models.LWWElement | undefined,
        references: Array<Protocol.Reference>,
    ): Promise<Models.Pointer.Pointer> {
        const processState = await this._store.getProcessState(
            this._system,
            this._processSecret.process,
        );

        if (processState.indices === undefined) {
            throw new Error('expected indices');
        }

        const event = new Models.Event(
            this._system,
            this._processSecret.process,
            processState.logicalClock.add(Long.UONE).toUnsigned(),
            contentType,
            content,
            lwwElementSet,
            lwwElement,
            references,
            processState.indices.indices,
        );

        const eventBuffer = Protocol.Event.encode(
            Models.eventToProto(event),
        ).finish();

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
        const event = Models.eventFromProto(
            Protocol.Event.decode(signedEvent.event),
        );

        const systemState = await this._store.getSystemState(event.system());

        const processState = await this._store.getProcessState(
            event.system(),
            event.process(),
        );

        const actions = [];

        if (
            event
                .contentType()
                .equals(Models.ContentType.ContentTypeDelete)
        ) {
            const deleteProto = Protocol.Delete.decode(event.content());

            if (!deleteProto.process) {
                throw new Error('delete expected process');
            }

            const deleteProcess = Models.Process.fromProto(deleteProto.process);

            let deleteProcessState = processState;

            if (!Models.Process.equal(event.process(), deleteProcess)) {
                deleteProcessState = await this._store.getProcessState(
                    event.system(),
                    deleteProcess,
                );
            }

            Ranges.insert(deleteProcessState.ranges, deleteProto.logicalClock);

            actions.push(
                this._store.putTombstone(
                    event.system(),
                    deleteProcess,
                    deleteProto.logicalClock,
                    await Models.signedEventToPointer(signedEvent),
                ),
            );

            actions.push(
                this._store.deleteIndexClaim(
                    event.system(),
                    event.process(),
                    event.logicalClock(),
                ),
            );
        } else if (
            event
                .contentType()
                .equals(Models.ContentType.ContentTypeClaim)
        ) {
            actions.push(
                this._store.putIndexClaim(
                    event.system(),
                    event.process(),
                    event.logicalClock(),
                ),
            );
        }

        updateSystemState(systemState, event);
        updateProcessState(processState, event);

        actions.push(this._store.putSystemState(event.system(), systemState));

        actions.push(
            this._store.putProcessState(
                event.system(),
                event.process(),
                processState,
            ),
        );

        actions.push(
            this._store.putEvent(
                event.system(),
                event.process(),
                event.logicalClock(),
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

function updateSystemState(
    state: Protocol.StorageTypeSystemState,
    event: Models.Event,
): void {
    {
        const lwwElementSet = event.lwwElementSet();

        if (lwwElementSet) {
            let found: Protocol.StorageTypeCRDTSetItem | undefined = undefined;

            for (const item of state.crdtSetItems) {
                if (
                    item.contentType.equals(event.contentType()) &&
                    Util.buffersEqual(item.value, lwwElementSet.value())
                ) {
                    found = item;
                    break;
                }
            }

            if (
                found &&
                found.unixMilliseconds < lwwElementSet.unixMilliseconds()
            ) {
                found.unixMilliseconds = lwwElementSet.unixMilliseconds();
                found.operation = Models.lwwElementSetOperationToProto(
                    lwwElementSet.operation(),
                );
            } else {
                state.crdtSetItems.push({
                    contentType: event.contentType(),
                    value: lwwElementSet.value(),
                    unixMilliseconds: lwwElementSet.unixMilliseconds(),
                    operation: Models.lwwElementSetOperationToProto(
                        lwwElementSet.operation(),
                    ),
                });
            }
        }
    }

    {
        const lwwElement = event.lwwElement();

        if (lwwElement) {
            let found: Protocol.StorageTypeCRDTItem | undefined = undefined;

            for (const item of state.crdtItems) {
                if (item.contentType.equals(event.contentType())) {
                    found = item;
                    break;
                }
            }

            if (
                found &&
                found.unixMilliseconds < lwwElement.unixMilliseconds()
            ) {
                found.unixMilliseconds = lwwElement.unixMilliseconds();
                found.value = lwwElement.value();
            } else {
                state.crdtItems.push({
                    contentType: event.contentType(),
                    value: lwwElement.value(),
                    unixMilliseconds: lwwElement.unixMilliseconds(),
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
                    event.process(),
                )
            ) {
                foundProcess = true;
                break;
            }
        }

        if (!foundProcess) {
            state.processes.push(event.process());
        }
    }
}

function updateProcessState(
    state: Protocol.StorageTypeProcessState,
    event: Models.Event,
): void {
    if (event.logicalClock().compare(state.logicalClock) == 1) {
        state.logicalClock = event.logicalClock();
    }

    if (state.indices === undefined) {
        throw new Error('expected indices');
    }

    Ranges.insert(state.ranges, event.logicalClock());

    {
        let foundIndex = false;

        for (const index of state.indices.indices) {
            if (index.indexType.equals(event.contentType())) {
                foundIndex = true;

                if (event.logicalClock().compare(index.logicalClock) == 1) {
                    index.logicalClock = event.logicalClock();
                }
            }
        }

        if (!foundIndex) {
            state.indices.indices.push({
                indexType: event.contentType(),
                logicalClock: event.logicalClock(),
            });
        }
    }
}
