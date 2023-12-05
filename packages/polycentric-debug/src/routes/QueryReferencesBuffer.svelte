<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { SERVER, printableEvent, replacer } from '../globals';

    let _output = "";
    let _reference = "";
    let _allPages = false;
    let _fromType: string = "";

    $: queryReferences(_reference, _fromType, _allPages)
        .then(response => _output = response);

    function stringToUint8Array(str: string) {
        const buffer = new ArrayBuffer(str.length);
        const uint8Array = new Uint8Array(buffer);
        for (let i = 0; i < str.length; i++) {
            uint8Array[i] = str.charCodeAt(i);
        }
        return uint8Array;
    }

    async function queryReferences(reference: string, fromType: string, allPages: Boolean): Promise<string> {
        if (reference.length < 8) {
            return "Reference length is too short.";
        }

        let fromTypeNum: number | undefined = parseInt(fromType);
        if (Number.isNaN(fromTypeNum)) {
            fromTypeNum = undefined;
        }

        const ref = Core.Models.bufferToReference(stringToUint8Array(reference));
        const queryRefEvents = fromTypeNum ? Core.Protocol.QueryReferencesRequestEvents.create({
            fromType: fromTypeNum
        }) : Core.Protocol.QueryReferencesRequestEvents.create({});

        const initialResponse = await Core.APIMethods.getQueryReferences(SERVER, ref, undefined, queryRefEvents);
        const items = initialResponse.items;
        let cursor = initialResponse.cursor;
        
        if (allPages) {
            while (cursor) {
                const response = await Core.APIMethods.getQueryReferences(SERVER, ref, cursor, queryRefEvents);
                items.push(...response.items);
                cursor = response.cursor;
            }
        }

        const responseEvents = items.map(i => Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(i.event!).event));
        console.log("responseEvents", responseEvents);
        return JSON.stringify(responseEvents.map(e => printableEvent(e)), replacer, 2);
    }
</script>

<div class="input-container">
    <input type="text" placeholder="Reference (5DePDzfyWkw)" bind:value={_reference} />
    <input type="text" placeholder="Content Type" list="contentTypes" bind:value={_fromType} />
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
    <div class="checkbox-group">
        <input type="checkbox" id="allPages" bind:checked={_allPages} />
        <label for="allPages">All Pages</label>
    </div>
</div>

<pre class="response-output">{_output}</pre>

<style>
    .checkbox-group {
        margin-left: 16px;
    }
</style>