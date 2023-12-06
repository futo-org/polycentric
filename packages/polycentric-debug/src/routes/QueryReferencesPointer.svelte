<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import { SERVER, decodeBase64UrlSafe, printableEvent, replacer, stringToBytes } from '../globals';

    let _output = "";
    let _reference = "";
    let _allPages = false;
    let _fromType: string = "";

    $: queryReferences(_reference, _fromType, _allPages)
        .then(response => _output = response);

    async function queryReferences(reference: string, fromType: string, allPages: Boolean): Promise<string> {
        if (reference.length < 8) {
            return "Reference length is too short.";
        }

        let fromTypeNum: number | undefined = parseInt(fromType);
        if (Number.isNaN(fromTypeNum)) {
            fromTypeNum = undefined;
        }

        const bytes = stringToBytes(decodeBase64UrlSafe(reference));
        const ref = Core.Protocol.Reference.create({
            referenceType: 2,
            reference: bytes
        });

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
    <input type="text" placeholder="Reference (CiQIARIggX0eCWctTm6WHVGot4sMAh7NDAIwWsIM5tRsOz9dX04SEgoQREeIaVXF5NsNMpcO07YeMxgBIiQIARIgXT86CuZFP3W7fvTvW/aLfgTD1xuRf54OhkQ4fpiVfsY=)" bind:value={_reference} />
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