<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { APIMethods, Models, Protocol } from '@polycentric/polycentric-core';
    import Long from 'long';
    import { bytesToBinaryString, decodeBase64UrlSafe, encodeBase64UrlSafe, serverStore, stringToBytes } from '../globals';
    import DisplayEvents from './DisplayEvents.svelte';

    let _keyType = "1";
    let _publicKey = "";
    let _contentTypeFilter = "";
    let _events: Core.Models.Event.Event[] = [];
    let _error: string | undefined = undefined;
    let _urlSlug = "";

    function parseUrlSlug() {
        if (!_urlSlug) {
            _error = "Please paste a slug from a user URL";
            return;
        }

        try {
            const decodedString = decodeBase64UrlSafe(_urlSlug);
            const bytes = stringToBytes(decodedString);
            const urlInfo = Core.Protocol.URLInfo.decode(bytes);
            const systemLink = Core.Models.URLInfo.getSystemLink(urlInfo);
            _publicKey = encodeBase64UrlSafe(bytesToBinaryString(systemLink.system.key));
            _error = undefined;
        } catch (e: any) {
            _error = e.toString();
        }
    }

    async function getAvatarBlobs(keyType: string, publicKey: string) {
        _error = undefined;
        _events = [];

        if (publicKey.length === 0) return;

        const keyTypeNum = parseInt(keyType);
        if (Number.isNaN(keyTypeNum)) {
            _error = "Key type is not a valid number";
            return;
        }

        if (publicKey.length < 32) {
            _error = "Key length is too short.";
            return;
        }

        try {
            const bytes = stringToBytes(decodeBase64UrlSafe(publicKey));
            const system = Models.PublicKey.fromProto(Protocol.PublicKey.create({
                keyType: keyTypeNum,
                key: bytes
            }));

            // 1. Get all processes for the user
            const serverRanges = await APIMethods.getRanges($serverStore, system);

            // 2. Create a request for ALL events from all processes.
            const allRangesForProcesses = serverRanges.rangesForProcesses.map(p => {
                return Models.Ranges.rangesForProcessFromProto({
                    process: p.process,
                    ranges: [{ low: Long.UZERO, high: Long.MAX_VALUE }],
                });
            });

            if (allRangesForProcesses.length === 0) {
                _error = "No processes found for this user.";
                return;
            }

            const allRangesForSystem = Models.Ranges.rangesForSystemFromProto({
                rangesForProcesses: allRangesForProcesses,
            });

            // 3. Fetch all events.
            const allEventsResponse = await APIMethods.getEvents($serverStore, system, allRangesForSystem);
            const allEvents = allEventsResponse.events.map(e => Models.Event.fromBuffer(Models.SignedEvent.fromProto(e).event));

            // 4. Find the latest avatar event from the complete list.
            const avatarEvents = allEvents.filter(e => e.contentType.equals(Models.ContentType.ContentTypeAvatar));
            if (avatarEvents.length === 0) {
                _error = "Avatar event not found in all user events.";
                return;
            }

            const latestAvatarEvent = avatarEvents.reduce((latest, current) => {
                if (!latest.unixMilliseconds) return current;
                if (!current.unixMilliseconds) return latest;
                return latest.unixMilliseconds.greaterThan(current.unixMilliseconds) ? latest : current;
            });

            if (!latestAvatarEvent.lwwElement) {
                _error = "Latest avatar event has no LWW element";
                return;
            }

            // 5. Get the manifest
            const imageBundle = Protocol.ImageBundle.decode(latestAvatarEvent.lwwElement.value);
            const manifest = imageBundle.imageManifests.find(m => m.width.toNumber() === 256);

            if (!manifest || !manifest.process) {
                _error = "Could not find a suitable image manifest";
                return;
            }

            const avatarProcess = Models.Process.fromProto(manifest.process);

            // 6. Filter the full event list to get just the blob sections we need.
            const blobSections = allEvents.filter(e => {
                return e.contentType.equals(Models.ContentType.ContentTypeBlobSection) &&
                       Models.Process.equal(e.process, avatarProcess) &&
                       manifest.sections.some(r => e.logicalClock.greaterThanOrEqual(r.low) && e.logicalClock.lessThanOrEqual(r.high));
            });
            
            if (blobSections.length === 0) {
                _error = "Found avatar event but no corresponding blob sections.";
                return;
            }

            // 7. Set the events to be displayed.
            _events = blobSections;

        } catch (e: any) {
            _error = e.toString();
        }
    }

    async function getPolycentricEvents(keyType: string, publicKey: string, contentTypeFilter: string) {
        _error = undefined;
        _events = [];

        if (publicKey.length === 0) {
            return;
        }

        const keyTypeNum = parseInt(keyType);
        if (Number.isNaN(keyTypeNum)) {
            _error = "Key type is not a valid number";
            return;
        }

        if (publicKey.length < 32) {
            _error = "Key length is too short.";
            return;
        }

        try {
            const bytes = stringToBytes(decodeBase64UrlSafe(publicKey));
            const system = Core.Models.PublicKey.fromProto(Core.Protocol.PublicKey.create({
                keyType: keyTypeNum,
                key: bytes
            }));

            const rangesForSystem = await APIMethods.getRanges($serverStore, system);

            const response = await Core.APIMethods.getEvents($serverStore, system, rangesForSystem);
            let responseEvents = response.events.map(m => Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(m).event));

            let contentTypeNum: number | undefined = parseInt(contentTypeFilter);
            if (Number.isNaN(contentTypeNum)) {
                contentTypeNum = undefined;
            }

            if (contentTypeNum) {
                responseEvents = responseEvents.filter(e => e.contentType.compare(new Long(contentTypeNum!, 0, true)) === 0)
            }
            _events = responseEvents;
        } catch (e: any) {
            _error = e.toString();
        }
    }

    $: getPolycentricEvents(_keyType, _publicKey, _contentTypeFilter);
</script>

<div class="input-container">
    <p><b>Connected to:</b></p>
    <input type="text" bind:value={$serverStore} style="width: 100%;" />
    <br/>
    <h3>1. Find a User's System Key</h3>
    <p>
        To find a user's system key, you can use a block explorer or look at the URL of a user's profile. It's the long string of characters that uniquely identifies them. You can paste the full slug from the URL (the part after `/user/`) below and click "Parse" to extract the key.
    </p>
    <br />
    <input placeholder="Paste slug from user URL here" bind:value={_urlSlug} style="width: 100%;" />
    <button on:click={parseUrlSlug}>Parse</button>
    <br />
    <br />
    <h3>2. Get User's Events</h3>
    <p>
        Paste the user's system key below. You can optionally filter by content type to narrow down the events. For avatars, the content type is 9.
    </p>
    <br/>
    <input placeholder="System Key Type (1)" bind:value={_keyType} />
    <input placeholder="System Key (e.g. EiBI23a4Yy9wK6NDBTM4q2b9V+5yN4yA9a0dpf0NLtOVLg==)" bind:value={_publicKey} />
    <input type="text" placeholder="Content Type Filter" list="contentTypes" bind:value={_contentTypeFilter} />
    <button on:click={() => getPolycentricEvents(_keyType, _publicKey, _contentTypeFilter)}>Force Refresh</button>
    <button on:click={() => getAvatarBlobs(_keyType, _publicKey)}>Fetch Avatar Blobs</button>
    <datalist id="contentTypes">
        <option value="1">Delete</option>
        <option value="2">System Processes</option>
        <option value="3">Post</option>
        <option value="4">Follow</option>
        <option value="5">Username</option>
        <option value="6">Description</option>
        <option value="7">Blob Meta</option>
        <option value="8">Blob Section</option>
        <option value="9">Avatar</option>
        <option value="10">Server</option>
        <option value="11">Vouch</option>
        <option value="12">Claim</option>
        <option value="13">Banner</option>
        <option value="14">Opinion</option>
        <option value="15">Store</option>
        <option value="16">Authority</option>
        <option value="17">Join Topic</option>
        <option value="18">Block</option>
    </datalist>
</div>

{#if _error}
    <pre class="response-output">{_error}</pre>
{:else}
    <DisplayEvents events={_events} />
{/if}
