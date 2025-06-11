<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import Long from 'long';
    import { bytesToString } from '../globals';
    import ImageViewer from './ImageViewer.svelte';

    export let events: Core.Models.Event.Event[] = [];

    let imageURL: string | undefined = undefined;

    $: {
        if (events.every(e => e.contentType.equals(Core.Models.ContentType.ContentTypeBlobSection))) {
            const sorted = [...events].sort((a, b) => a.logicalClock.compare(b.logicalClock));
            const buffers = sorted.map(e => e.content);
            const blob = new Blob(buffers);
            imageURL = URL.createObjectURL(blob);
        } else {
            imageURL = undefined;
        }
    }

    function getContentTypeName(contentType: Core.Models.ContentType.ContentType): string {
        const typeInt = contentType.toInt();
        switch (typeInt) {
            case 1: return 'Delete';
            case 2: return 'System Processes';
            case 3: return 'Post';
            case 4: return 'Follow';
            case 5: return 'Username';
            case 6: return 'Description';
            case 7: return 'Blob Meta';
            case 8: return 'Blob Section';
            case 9: return 'Avatar';
            case 10: return 'Server';
            case 11: return 'Vouch';
            case 12: return 'Claim';
            case 13: return 'Banner';
            case 14: return 'Opinion';
            case 15: return 'Store';
            case 16: 'Authority';
            case 17: return 'Join Topic';
            case 18: return 'Block';
            default: return `Unknown (${typeInt})`;
        }
    }

    function getEventValue(event: Core.Models.Event.Event): any {
        // LWW Element types
        if (event.lwwElement) {
            switch (event.contentType.toInt()) {
                case Core.Models.ContentType.ContentTypeUsername.toInt():
                case Core.Models.ContentType.ContentTypeDescription.toInt():
                    return { type: 'string', value: bytesToString(event.lwwElement.value) };
                case Core.Models.ContentType.ContentTypeAvatar.toInt():
                case Core.Models.ContentType.ContentTypeBanner.toInt():
                    try {
                        const imageBundle = Core.Protocol.ImageBundle.decode(
                            event.lwwElement.value,
                        );
                        return { type: 'image', value: imageBundle, system: event.system };
                    } catch (e) {
                        return { type: 'string', value: `Error decoding ImageBundle: ${e}` };
                    }
                default:
                    return { type: 'json', value: event.lwwElement };
            }
        }
        
        // Content types
        if (event.content) {
            switch (event.contentType.toInt()) {
                case Core.Models.ContentType.ContentTypePost.toInt():
                    return { type: 'string', value: bytesToString(event.content) };
                case Core.Models.ContentType.ContentTypeClaim.toInt():
                    return { type: 'json', value: Core.Protocol.Claim.decode(event.content) };
                case Core.Models.ContentType.ContentTypeFollow.toInt():
                case Core.Models.ContentType.ContentTypeVouch.toInt():
                    return { type: 'json', value: Core.Protocol.Pointer.decode(event.content) };
                default:
                    return { type: 'json', value: event.content };
            }
        }

        // LWW Element Set types
        if (event.lwwElementSet) {
            switch (event.contentType.toInt()) {
                case Core.Models.ContentType.ContentTypeServer.toInt():
                    return { type: 'string', value: bytesToString(event.lwwElementSet.value) };
                default:
                    return { type: 'json', value: event.lwwElementSet };
            }
        }

        return { type: 'string', value: 'No displayable value in event' };
    }

    function replacer(key: any, value: any) {
        if (value instanceof Long) {
            return value.toString();
        }
        if (value instanceof Uint8Array) {
            return `[Uint8Array length ${value.length}]`;
        }
        return value;
    }
</script>

{#if imageURL}
    <img src={imageURL} alt="Reconstructed blob" />
{:else}
    <div>
        {#each events as event}
            {@const eventValue = getEventValue(event)}
            <div style="margin-bottom: 2em; padding: 1em; border: 1px solid #ccc; border-radius: 5px;">
                <h4>Event Details</h4>
                <ul style="list-style: none; padding-left: 0;">
                    <li><b>Content Type:</b> {getContentTypeName(event.contentType)}</li>
                    {#if event.unixMilliseconds && event.unixMilliseconds.toNumber() > 0}
                        <li><b>Timestamp:</b> {new Date(event.unixMilliseconds.toNumber()).toLocaleString()}</li>
                    {/if}
                    <li><b>System:</b> <code>{Core.Models.PublicKey.toString(event.system)}</code></li>
                    <li><b>Process:</b> <code>{Core.Models.Process.toString(event.process)}</code></li>
                    <li><b>Logical Clock:</b> {event.logicalClock.toString()}</li>
                </ul>
                
                <h5>Value:</h5>
                {#if eventValue.type === 'image'}
                    <ImageViewer system={eventValue.system} imageBundle={eventValue.value} />
                {:else if eventValue.type === 'string'}
                    <p>{eventValue.value}</p>
                {:else}
                    <pre>{JSON.stringify(eventValue.value, replacer, 2)}</pre>
                {/if}
                
                {#if event.references && event.references.length > 0}
                    <h5>References:</h5>
                    <pre>{JSON.stringify(event.references, replacer, 2)}</pre>
                {/if}

                <details>
                    <summary>Full Event Object</summary>
                    <pre>{JSON.stringify(event, replacer, 2)}</pre>
                </details>
            </div>
        {/each}
    </div>
{/if}

<style>
    pre {
        background-color: #f5f5f5;
        padding: 10px;
        border-radius: 5px;
        white-space: pre-wrap;
        word-wrap: break-word;
    }
</style> 