<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { onMount } from 'svelte';
    import { serverStore } from '../globals';

    export let system: Core.Models.PublicKey.PublicKey;
    export let process: Core.Models.Process.Process;
    export let sections: Core.Protocol.Range[];
    export let mimeType: string;

    let objectURL: string | undefined;
    let error: string | undefined;

    onMount(() => {
        let canceled = false;

        const fetchSections = async () => {
            try {
                const rangesForProcess = Core.Models.Ranges.rangesForProcessFromProto({
                    process: process,
                    ranges: sections,
                });

                const rangesForSystem = Core.Models.Ranges.rangesForSystemFromProto({
                    rangesForProcesses: [rangesForProcess],
                });

                const events = await Core.APIMethods.getEvents($serverStore, system, rangesForSystem);

                if (canceled) return;

                const sortedEvents = events.events.sort((a, b) => {
                    const eventA = Core.Models.Event.fromBuffer(a.event);
                    const eventB = Core.Models.Event.fromBuffer(b.event);
                    return eventA.logicalClock.compare(eventB.logicalClock);
                });

                const buffers = sortedEvents.map(signedEvent => {
                    const event = Core.Models.Event.fromBuffer(signedEvent.event);
                    return event.content;
                });

                const blob = new Blob(buffers, { type: mimeType });
                objectURL = URL.createObjectURL(blob);
            } catch (e) {
                if (canceled) return;
                error = e instanceof Error ? e.message : 'An unknown error occurred';
            }
        };

        fetchSections();

        return () => {
            canceled = true;
            if (objectURL) {
                URL.revokeObjectURL(objectURL);
            }
        };
    });
</script>

{#if objectURL}
    <img src={objectURL} alt="Blob content" style="max-width: 256px; max-height: 256px;" />
{:else if error}
    <p>Error: {error}</p>
{:else}
    <p>Loading blob...</p>
{/if} 