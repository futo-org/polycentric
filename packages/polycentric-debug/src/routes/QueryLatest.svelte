<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { APIMethods } from '@polycentric/polycentric-core';
    import Long from 'long';
    import { serverStore, decodeBase64UrlSafe, printableEvent, replacer, stringToBytes } from '../globals';

    let _output = "";
    let _keyType = "1";
    let _publicKey = "";
    let _contentTypeFilter = "";

    $: queryLatest(_keyType, _publicKey, _contentTypeFilter)
        .then(response => _output = response);

    async function queryLatest(keyType: string, publicKey: string, contentTypeFilter: string): Promise<string> {
        const keyTypeNum = parseInt(keyType);
        if (Number.isNaN(keyTypeNum)) {
            return "Key type is not a valid number";
        }

        if (publicKey.length < 32) {
            return "Key length is too short.";
        }

        const bytes = stringToBytes(decodeBase64UrlSafe(publicKey));
        const system = Core.Models.PublicKey.fromProto(Core.Protocol.PublicKey.create({
            keyType: keyTypeNum,
            key: bytes
        }));

        let contentTypeNum: number | undefined = parseInt(contentTypeFilter);
        if (Number.isNaN(contentTypeNum)) {
            contentTypeNum = undefined;
        }

        const response = contentTypeNum 
            ? await APIMethods.getQueryLatest($serverStore, system, [new Long(contentTypeNum!, 0, true) as any])
            : await APIMethods.getQueryLatest($serverStore, system, [...Array(1000).keys()].map(v => new Long(v, 0, true) as any));
        let responseEvents = response.events.map(m => Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(m).event));
        console.log("responseEvents", responseEvents);

        return JSON.stringify(responseEvents.map(e => printableEvent(e)), replacer, 2);
    }
</script>

<div class="input-container">
    <input placeholder="System Key Type (1)" bind:value={_keyType} />
    <input placeholder="System Key (gX0eCWctTm6WHVGot4sMAh7NDAIwWsIM5tRsOz9dX04=)" bind:value={_publicKey} />
    <input type="text" placeholder="Content Type Filter" list="contentTypes" bind:value={_contentTypeFilter} />
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
    </datalist>
</div>

<pre class="response-output">{_output}</pre>
