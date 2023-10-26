<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import type { ClaimType } from '@polycentric/polycentric-core/dist/models';
    import Long from 'long';
    import { SERVER, TRUST_ROOT, replacer } from '../globals';

    let _output = "";
    let _claimType = "";
    let _claimValue = "";

    $: getPolycentricProfileByClaim(_claimType, _claimValue)
        .then(response => _output = response);

    async function getPolycentricProfileByClaim(claimType: string, claimValue: string): Promise<string> {
        const claimTypeNum = parseInt(claimType);
        if (Number.isNaN(claimTypeNum)) {
            return "Claim type is not a valid number";
        }

        if (claimValue.length < 2) {
            return "Claim value must be more than 2 characters.";
        }

        const claimTypeLong = new Long(claimTypeNum, 0, true) as ClaimType.ClaimType;
        console.log("getResolveClaim", {claimTypeNum, claimTypeLong, claimValue})
        const response = await Core.APIMethods.getResolveClaim(SERVER, TRUST_ROOT, claimTypeLong, claimValue);

        const responseEvents = response.matches.map(m => <any> { 
            claim: Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(m.claim!).event), 
            proofChain:  m.proofChain.map(c => Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(c).event))
        });

        console.log("responseEvents", responseEvents);
        return JSON.stringify(responseEvents, replacer, 2);
    }
</script>

<h1>Get Polycentric Profile By Claim (Any Field)</h1>

<div class="input-container">
    <input placeholder="Claim type (2)" bind:value={_claimType} />
    <input placeholder="Claim value (@koen-futo)" bind:value={_claimValue} />
</div>

<pre class="response-output">{_output}</pre>
