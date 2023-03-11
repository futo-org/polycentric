import Long from 'long';

import * as APIMethods from './api-methods';
import * as ProcessHandle from './process-handle';
import * as Models from './models';
import * as Store from './store';
import * as Ranges from './ranges';
import * as Protocol from './protocol';

async function loadRanges(
    store: Store.Store,
    system: Models.PublicKey,
    process: Models.Process.Process,
    ranges: Array<Ranges.IRange>,
): Promise<Array<Protocol.SignedEvent>> {
    const result: Array<Protocol.SignedEvent> = [];

    for (const range of ranges) {
        for (
            var i = range.low;
            i.lessThanOrEqual(range.high);
            i = i.add(Long.UONE)
        ) {
            const event = await store.getSignedEvent(system, process, i);

            if (event) {
                result.push(event);
            }
        }
    }

    return result;
}

export async function saveBatch(
    processHandle: ProcessHandle.ProcessHandle,
    events: Protocol.Events,
): Promise<void> {
    for (const rawEvent of events.events) {
        await processHandle.ingest(Models.signedEventFromProto(rawEvent));
    }
}

export async function backfillClient(
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey,
    server: string,
): Promise<void> {
    const rangesForSystem = await APIMethods.getRanges(server, system);

    for (const item of rangesForSystem.rangesForProcesses) {
        if (!item.process) {
            continue;
        }

        const processState = await processHandle
            .store()
            .getProcessState(system, Models.Process.fromProto(item.process));

        const clientNeeds = Ranges.subtractRange(
            item.ranges,
            processState.ranges,
        );

        if (clientNeeds.length === 0) {
            break;
        }

        const batch = Ranges.takeRangesMaxItems(
            clientNeeds,
            new Long(10, 0, true),
        );

        const events = await APIMethods.getEvents(server, system, {
            rangesForProcesses: [
                {
                    process: item.process,
                    ranges: batch,
                },
            ],
        });

        await saveBatch(processHandle, events);
    }
}

export async function backFillServers(
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey,
): Promise<void> {
    const systemState = await processHandle.loadSystemState(system);

    for (const server of systemState.servers()) {
        try {
            const rangesForSystem = await APIMethods.getRanges(server, system);

            for (const process of systemState.processes()) {
                let rangesForProcess: Array<Protocol.Range> = [];

                for (const item of rangesForSystem.rangesForProcesses) {
                    if (!item.process) {
                        continue;
                    }

                    if (
                        Models.Process.equal(
                            Models.Process.fromProto(item.process),
                            process,
                        )
                    ) {
                        rangesForProcess = item.ranges;
                        break;
                    }
                }

                const processState = await processHandle
                    .store()
                    .getProcessState(system, process);

                const serverNeeds = Ranges.subtractRange(
                    processState.ranges,
                    rangesForProcess,
                );

                if (serverNeeds.length === 0) {
                    break;
                }

                const batch = Ranges.takeRangesMaxItems(
                    serverNeeds,
                    new Long(20, 0, true),
                );

                const events = await loadRanges(
                    processHandle.store(),
                    system,
                    process,
                    batch,
                );

                await APIMethods.postEvents(server, {
                    events: events,
                });
            }
        } catch (err) {
            console.warn(err);
        }
    }
}
