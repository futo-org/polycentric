<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import BlobViewer from './BlobViewer.svelte';

    export let system: Core.Models.PublicKey.PublicKey;
    export let imageBundle: Core.Protocol.ImageBundle;

    const manifest = imageBundle.imageManifests.find(m => m.width.toNumber() === 256);
</script>

<div>
    {#if manifest && manifest.process}
        <BlobViewer
            system={system}
            process={Core.Models.Process.fromProto(manifest.process)}
            sections={manifest.sections}
            mimeType={manifest.mime}
        />
    {:else}
        <p>No suitable image manifest found.</p>
    {/if}
</div> 