<script lang="ts">
    import * as Core from '@polycentric/polycentric-core';
    import type { ClaimType } from '@polycentric/polycentric-core/dist/models';
    import Long from 'long';
    import { SERVER, TRUST_ROOT, printableEvent, replacer } from '../globals';

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
            claim: printableEvent(Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(m.claim!).event)), 
            proofChain:  m.proofChain.map(c => printableEvent(Core.Models.Event.fromBuffer(Core.Models.SignedEvent.fromProto(c).event)))
        });

        console.log("responseEvents", responseEvents);
        return JSON.stringify(responseEvents, replacer, 2);
    }
</script>

<div class="input-container">
    <input type="text" placeholder="Claim type (2)" list="claimTypes" bind:value={_claimType} />
    <datalist id="claimTypes">
        <option value="1">HackerNews</option>
        <option value="2">YouTube</option>
        <option value="3">Odysee</option>
        <option value="4">Rumble</option>
        <option value="5">Twitter</option>
        <option value="6">Bitcoin</option>
        <option value="7">Generic</option>
        <option value="8">Discord</option>
        <option value="9">Instagram</option>
        <option value="10">GitHub</option>
        <option value="11">Minds</option>
        <option value="12">Patreon</option>
        <option value="13">Substack</option>
        <option value="14">Twitch</option>
        <option value="15">Website</option>
        <option value="16">Kick</option>
        <option value="17">Soundcloud</option>
        <option value="18">Vimeo</option>
        <option value="19">Nebula</option>
        <option value="20">URL</option>
        <option value="21">Occupation</option>
        <option value="22">Skill</option>
        <option value="23">Spotify</option>
        <option value="24">Spreadshop</option>
        <option value="25">Polycentric</option>
        <option value="26">Gitlab</option>
    </datalist>    
    <input placeholder="Claim value (@koen-futo)" bind:value={_claimValue} />
</div>

<pre class="response-output">{_output}</pre>
