<script>
    import Constants from "./Constants.svelte";
    import GetEvents from "./GetEvents.svelte";
    import QueryReferencesBuffer from "./QueryReferencesBuffer.svelte";
    import QueryReferencesPointer from "./QueryReferencesPointer.svelte";
    import ResolveClaim from "./ResolveClaim.svelte";
  
    let activeTab = 'events';
</script>

<style>
    .tabs {
        display: flex;
    }

    .tab {
        cursor: pointer;
        padding: 10px;
        border: 1px solid #ccc;
        margin-right: 10px;
    }

    .active {
        background-color: #ccc;
    }
</style>

<h1>Get Polycentric Data</h1>


<div class="tabs" style="margin-bottom: 10px;">
    <div role="button" tabindex="0" class="tab" class:active={activeTab === 'events'} on:click={() => activeTab = 'events'}>
        Events By System
    </div>
    <div role="button" tabindex="1" class="tab" class:active={activeTab === 'resolveClaim'} on:click={() => activeTab = 'resolveClaim'}>
        Resolve Claim
    </div>
    <div role="button" tabindex="2" class="tab" class:active={activeTab === 'queryReferencesBuffer'} on:click={() => activeTab = 'queryReferencesBuffer'}>
        Query References Buffer
    </div>
    <div role="button" tabindex="3" class="tab" class:active={activeTab === 'queryReferencesPointer'} on:click={() => activeTab = 'queryReferencesPointer'}>
        Query References Pointer
    </div>
</div>

{#if activeTab === 'events'}
    <GetEvents />
{:else if activeTab === 'resolveClaim'}
    <ResolveClaim />
{:else if activeTab === 'queryReferencesBuffer'}
    <QueryReferencesBuffer />
{:else if activeTab === 'queryReferencesPointer'}
    <QueryReferencesPointer />
{/if}

<Constants />