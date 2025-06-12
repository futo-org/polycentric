<script lang="ts">
    import { Models } from '@polycentric/polycentric-core';
    import { printableEvent, replacer } from '../globals';

    export let localEvents: Models.SignedEvent.SignedEvent[] = [];
    export let serverEvents: Models.SignedEvent.SignedEvent[] = [];
</script>

<div style="display: flex; gap: 20px; font-family: monospace;">
    <div style="flex: 1; border: 1px solid #ccc; padding: 10px; border-radius: 5px; overflow-x: auto;">
        <h2>Local Events ({localEvents.length})</h2>
        <hr />
        {#each localEvents as signedEvent}
            <pre>{JSON.stringify(printableEvent(Models.Event.fromBuffer(signedEvent.event)), replacer, 2)}</pre>
            <hr />
        {:else}
            <p>No local events found.</p>
        {/each}
    </div>
    <div style="flex: 1; border: 1px solid #ccc; padding: 10px; border-radius: 5px; overflow-x: auto;">
        <h2>Server Events ({serverEvents.length})</h2>
        <hr />
        {#each serverEvents as signedEvent}
            <pre>{JSON.stringify(printableEvent(Models.Event.fromBuffer(signedEvent.event)), replacer, 2)}</pre>
            <hr />
        {:else}
            <p>No server events found.</p>
        {/each}
    </div>
</div> 