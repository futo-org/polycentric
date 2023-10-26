<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { SERVER, replacer } from '../globals';
    import { APIMethods } from '@polycentric/polycentric-core';
    import Long from 'long';

    let _output = "";
    let _keyType = "1";
    let _publicKey = "";
    let _contentTypeFilter = "";

    $: getPolycentricEvents(_keyType, _publicKey, _contentTypeFilter)
        .then(response => _output = response);

    async function getPolycentricEvents(keyType: string, publicKey: string, contentTypeFilter: string): Promise<string> {
        const keyTypeNum = parseInt(keyType);
        if (Number.isNaN(keyTypeNum)) {
            return "Key type is not a valid number";
        }

        if (publicKey.length < 32) {
            return "Key length is too short.";
        }

        const bytes = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
        const system = Core.Models.PublicKey.fromProto(Core.Protocol.PublicKey.create({
            keyType: keyTypeNum,
            key: bytes
        }));

        const rangesForSystem = await APIMethods.getRanges(SERVER, system);
        console.log("rangesForSystem", rangesForSystem);

        const response = await Core.APIMethods.getEvents(SERVER, system, rangesForSystem);
        let responseEvents = response.events.map(m => Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(m).event));
        console.log("responseEvents", responseEvents);

        let contentTypeNum: number | undefined = parseInt(contentTypeFilter);
        if (Number.isNaN(contentTypeNum)) {
            contentTypeNum = undefined;
        }

        if (contentTypeNum) {
            responseEvents = responseEvents.filter(e => e.contentType.compare(new Long(contentTypeNum!, 0, true)) === 0)
        }

        return JSON.stringify(responseEvents, replacer, 2);
    }
</script>

<h1>Get Polycentric Events By Public Key</h1>

<div class="input-container">
    <input placeholder="Key Type (1)" bind:value={_keyType} />
    <input placeholder="Public Key (gX0eCWctTm6WHVGot4sMAh7NDAIwWsIM5tRsOz9dX04=)" bind:value={_publicKey} />
    <input placeholder="Content Type Filter (1)" bind:value={_contentTypeFilter} />
</div>

<pre class="response-output">{_output}</pre>
