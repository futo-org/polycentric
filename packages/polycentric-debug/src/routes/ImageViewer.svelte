<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import BlobViewer from './BlobViewer.svelte';

    export let system: Core.Models.PublicKey.PublicKey;
    export let imageBundle: Core.Protocol.ImageBundle;

    let manifest: Core.Protocol.ImageManifest | undefined;

    if (imageBundle.imageManifests && imageBundle.imageManifests.length > 0) {
        manifest = imageBundle.imageManifests.reduce((largest, current) => {
            return current.width.greaterThan(largest.width) ? current : largest;
        });
    }
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