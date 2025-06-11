<script lang="ts">
    import { MetaStore, Models, PersistenceDriver, ProcessHandle } from '@polycentric/polycentric-core';
    import Long from 'long';
    import { get } from 'svelte/store';
    import { decodeBase64UrlSafe, processHandleStore, serverStore, stringToBytes } from '../globals';
    import Constants from "./Constants.svelte";
    import GetEvents from "./GetEvents.svelte";
    import QueryLatest from "./QueryLatest.svelte";
    import QueryReferencesBuffer from "./QueryReferencesBuffer.svelte";
    import QueryReferencesPointer from "./QueryReferencesPointer.svelte";
    import ResolveClaim from "./ResolveClaim.svelte";
  
    let activeTab = 'events';
    let privateKeyInput = '';
    let loadProfileError = '';

    async function loadProfileFromKey() {
        if (!privateKeyInput) {
            loadProfileError = 'Please provide a private key.';
            return;
        }

        try {
            loadProfileError = '';
            const keyBytes = stringToBytes(decodeBase64UrlSafe(privateKeyInput));
            const privateKey = Models.PrivateKey.fromProto({
                keyType: new Long(1), // Assuming Ed25519
                key: keyBytes,
            });

            // Note: createPersistenceDriverMemory is used here for simplicity in the debug tool.
            // All events will be fetched from the server upon load, but new local events
            // created in this session will be available. For a fully persistent debug
            // experience, a browser-based driver would be needed.
            const metaStore = await MetaStore.createMetaStore(
                PersistenceDriver.createPersistenceDriverMemory(),
            );

            const handle = await ProcessHandle.createProcessHandleFromKey(metaStore, privateKey);
            
            await handle.addServer(get(serverStore));
            await ProcessHandle.fullSync(handle);
            
            processHandleStore.set(handle);

        } catch (e: any) {
            loadProfileError = `Failed to load profile: ${e.toString()}`;
            console.error(e);
        }
    }
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

    .profile-loader {
        padding: 15px;
        border: 1px solid #ccc;
        margin-bottom: 20px;
        background-color: #f9f9f9;
    }
</style>

<h1>Get Polycentric Data</h1>

<div class="profile-loader">
    <h3>Load Your Profile</h3>
    <p>Paste your Base64URL encoded private key to load your profile and view local events.</p>
    <input type="password" placeholder="Enter private key" bind:value={privateKeyInput} style="width: 400px;" />
    <button on:click={loadProfileFromKey}>Load Profile</button>
    {#if loadProfileError}
        <p style="color:red">{loadProfileError}</p>
    {/if}
    {#if $processHandleStore}
        <p style="color:green">Profile loaded. System: {Models.PublicKey.toString($processHandleStore.system())}</p>
    {/if}
</div>

{#if $processHandleStore}
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
    <div role="button" tabindex="3" class="tab" class:active={activeTab === 'queryLatest'} on:click={() => activeTab = 'queryLatest'}>
        Query Latest
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
{:else if activeTab === 'queryLatest'}
    <QueryLatest />
{/if}
{:else}
    <p>Please load a profile to continue.</p>
{/if}

<Constants />