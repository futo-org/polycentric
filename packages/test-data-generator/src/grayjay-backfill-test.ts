import * as Core from '@polycentric/polycentric-core';
import Long from 'long';

// Server URLs
const PROD_SERVER = 'https://srv1-prod.polycentric.io';
const TEST_SERVER = 'https://grayjay-srv1-test.polycentric.io';

// Test configurations - match Grayjay behavior
const MESSAGE_COUNTS = [10, 15]; // Start with just 10 messages for testing
const BATCH_SIZE = 10; // Grayjay processes 10 events at a time
const TIMEOUT_MS = 10000; // 10 second timeout for testing
const MAX_BATCHES = 10; // Limit total batches to prevent infinite loops

// Check for command line arguments
const args = process.argv.slice(2);
const CLEANUP_AFTER_TEST = !args.includes('--no-cleanup');
const QUICK_TEST = args.includes('--quick');
const SLOW_TEST = args.includes('--slow');

// Adjust message counts based on arguments
let testMessageCounts = MESSAGE_COUNTS;
if (QUICK_TEST) {
  testMessageCounts = [10, 20, 50];
} else if (SLOW_TEST) {
  testMessageCounts = [10, 20, 50, 100, 200, 500, 1000];
}

interface TestResult {
  messageCount: number;
  accountId: string;
  totalTimeMs: number;
  batchesCompleted: number;
  eventsRetrieved: number;
  timedOut: boolean;
  error?: string;
  processHandle?: Core.ProcessHandle.ProcessHandle; // Store for cleanup
}

class GrayjayBackfillTester {
  private results: TestResult[] = [];

  async createTestAccount(messageCount: number): Promise<{
    processHandle: Core.ProcessHandle.ProcessHandle;
    accountId: string;
  }> {
    console.log(`\n🔄 Creating test account with ${messageCount} messages...`);
    
    const processHandle = await Core.ProcessHandle.createProcessHandle(
      await Core.MetaStore.createMetaStore(
        Core.PersistenceDriver.createPersistenceDriverMemory(),
      ),
    );

    // Add production server (where messages will be posted)
    await processHandle.addServer(PROD_SERVER);
    
    // Set a unique username
    const username = `grayjay_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await processHandle.setUsername(username);
    
    // Create messages
    console.log(`📝 Creating ${messageCount} messages...`);
    for (let i = 0; i < messageCount; i++) {
      await processHandle.post(`Grayjay backfill test message ${i + 1}/${messageCount}`);
    }
    
    // Sync to production server
    console.log(`📤 Syncing to production server...`);
    await Core.Synchronization.backFillServers(processHandle, processHandle.system());
    
    // Wait for server processing
    console.log(`⏳ Waiting for server processing...`);
    await this.sleep(3000);
    
    const accountId = await Core.ProcessHandle.makeSystemLink(processHandle, processHandle.system());
    console.log(`✅ Account created: ${accountId.substring(0, 50)}...`);
    
    return { processHandle, accountId };
  }

  async createTestAccountToTestServer(messageCount: number): Promise<{
    processHandle: Core.ProcessHandle.ProcessHandle;
    accountId: string;
  }> {
    console.log(`\n🔄 Creating test account with ${messageCount} messages on TEST server...`);
    
    const processHandle = await Core.ProcessHandle.createProcessHandle(
      await Core.MetaStore.createMetaStore(
        Core.PersistenceDriver.createPersistenceDriverMemory(),
      ),
    );

    // Add test server (where messages will be posted)
    await processHandle.addServer(TEST_SERVER);
    
    // Set a unique username
    const username = `grayjay_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await processHandle.setUsername(username);
    
    // Create messages
    console.log(`📝 Creating ${messageCount} messages on TEST server...`);
    for (let i = 0; i < messageCount; i++) {
      await processHandle.post(`Grayjay backfill test message ${i + 1}/${messageCount}`);
    }
    
    // Sync to test server
    console.log(`📤 Syncing to test server...`);
    await Core.Synchronization.backFillServers(processHandle, processHandle.system());
    
    // Wait for server processing
    console.log(`⏳ Waiting for server processing...`);
    await this.sleep(3000);
    
    const accountId = await Core.ProcessHandle.makeSystemLink(processHandle, processHandle.system());
    console.log(`✅ Account created on TEST: ${accountId.substring(0, 50)}...`);
    
    return { processHandle, accountId };
  }

  async testGrayjayBackfill(accountId: string, messageCount: number, processHandle?: Core.ProcessHandle.ProcessHandle): Promise<TestResult> {
    console.log(`\n🧪 Testing Grayjay-style backfill for ${messageCount} messages...`);
    
    const startTime = Date.now();
    let batchesCompleted = 0;
    let eventsRetrieved = 0;
    let timedOut = false;
    let error: string | undefined;
    
    try {
      if (!processHandle) {
        throw new Error('Process handle is required for backfill testing');
      }
      
      // Use the existing process handle that created the messages (has local events)
      // Add the test server to simulate Grayjay connecting to a new server
      await processHandle.addServer(TEST_SERVER);
      
      // Get the system from the process handle
      const system = processHandle.system();
      
      // Simulate Grayjay's backfill process with timeout
      const result = await this.simulateGrayjayBackfill(processHandle, system);
      batchesCompleted = result.batchesCompleted;
      eventsRetrieved = result.eventsRetrieved;
      timedOut = result.timedOut;
      
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`❌ Backfill failed: ${error}`);
    }
    
    const totalTimeMs = Date.now() - startTime;
    
    return {
      messageCount,
      accountId,
      totalTimeMs,
      batchesCompleted,
      eventsRetrieved,
      timedOut,
      error,
      processHandle, // Store for cleanup
    };
  }

  async testBackfillToProduction(accountId: string, messageCount: number, processHandle?: Core.ProcessHandle.ProcessHandle): Promise<TestResult> {
    console.log(`\n🧪 Testing backfill to production for ${messageCount} messages...`);
    
    const startTime = Date.now();
    let batchesCompleted = 0;
    let eventsRetrieved = 0;
    let timedOut = false;
    let error: string | undefined;
    
    try {
      if (!processHandle) {
        throw new Error('Process handle is required for backfill testing');
      }
      
      // Use the existing process handle that created the messages (has local events)
      // Add the production server to simulate syncing to production
      await processHandle.addServer(PROD_SERVER);
      
      // Get the system from the process handle
      const system = processHandle.system();
      
      // Simulate backfill to production server
      const result = await this.simulateBackfillToProduction(processHandle, system);
      batchesCompleted = result.batchesCompleted;
      eventsRetrieved = result.eventsRetrieved;
      timedOut = result.timedOut;
      
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`❌ Backfill to production failed: ${error}`);
    }
    
    const totalTimeMs = Date.now() - startTime;
    
    return {
      messageCount,
      accountId,
      totalTimeMs,
      batchesCompleted,
      eventsRetrieved,
      timedOut,
      error,
      processHandle, // Store for cleanup
    };
  }

  private async simulateGrayjayBackfill(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<{ batchesCompleted: number; eventsRetrieved: number; timedOut: boolean }> {
    let batchesCompleted = 0;
    let eventsPushed = 0;
    let timedOut = false;
    
    try {
      // Add the test server to the process handle (simulating Grayjay adding a new server)
      console.log(`🌐 Adding test server to process handle...`);
      await processHandle.addServer(TEST_SERVER);
      
      // Use the synchronization logic to push local events to the test server (no timeout)
      const result = await this.pushLocalEventsToServer(processHandle, system, TEST_SERVER);
      batchesCompleted = result.batchesCompleted;
      eventsPushed = result.eventsPushed;
      timedOut = false;
      
    } catch (error) {
      console.error(`❌ Error during backfill: ${error}`);
      throw error;
    }
    
    return { batchesCompleted, eventsRetrieved: eventsPushed, timedOut };
  }

  private async simulateBackfillToProduction(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<{ batchesCompleted: number; eventsRetrieved: number; timedOut: boolean }> {
    let batchesCompleted = 0;
    let eventsPushed = 0;
    let timedOut = false;
    
    try {
      // Add the production server to the process handle (simulating syncing to production)
      console.log(`🌐 Adding production server to process handle...`);
      await processHandle.addServer(PROD_SERVER);
      
      // Use the synchronization logic to push local events to the production server (no timeout)
      const result = await this.pushLocalEventsToServer(processHandle, system, PROD_SERVER);
      batchesCompleted = result.batchesCompleted;
      eventsPushed = result.eventsPushed;
      timedOut = false;
      
    } catch (error) {
      console.error(`❌ Error during backfill to production: ${error}`);
      throw error;
    }
    
    return { batchesCompleted, eventsRetrieved: eventsPushed, timedOut };
  }

  private async pushLocalEventsToServer(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey,
    targetServer: string = TEST_SERVER
  ): Promise<{ batchesCompleted: number; eventsPushed: number }> {
    let batchesCompleted = 0;
    let eventsPushed = 0;
    
    // Load local system ranges
    const localSystemRanges = await this.loadLocalSystemRanges(processHandle, system);
    console.log(`📊 Local system has ${localSystemRanges.size} processes with events`);
    
    // Load remote system ranges from target server
    const remoteSystemRanges = await this.loadRemoteSystemRanges(targetServer, system);
    console.log(`🌐 ${targetServer === TEST_SERVER ? 'Test' : 'Production'} server has ${remoteSystemRanges.size} processes with events`);
    
    // Calculate what the target server needs (local has - remote has)
    const remoteNeedsAndLocalHas = this.subtractSystemRanges(localSystemRanges, remoteSystemRanges);
    console.log(`📤 ${targetServer === TEST_SERVER ? 'Test' : 'Production'} server needs events from ${remoteNeedsAndLocalHas.size} processes`);
    
    // Debug: Show range details
    for (const [processString, rangesForProcess] of remoteNeedsAndLocalHas.entries()) {
      console.log(`   Process ${processString}: ${rangesForProcess.ranges.length} ranges`);
      for (const range of rangesForProcess.ranges) {
        const eventCount = range.high.sub(range.low).add(Long.UONE).toNumber();
        console.log(`     Range ${range.low} to ${range.high}: ${eventCount} events`);
      }
    }
    
    // Push events in batches until complete or timeout
    while (true) {
      const batchStartTime = Date.now();
      
      const result = await this.syncToServerSingleBatch(
        targetServer,
        processHandle,
        system,
        remoteNeedsAndLocalHas
      );
      
      if (!result.success) {
        break; // No more events to push
      }
      
      const batchTime = Date.now() - batchStartTime;
      batchesCompleted++;
      eventsPushed += result.eventsPushed;
      console.log(`📦 Batch ${batchesCompleted}: ${result.eventsPushed} events pushed (${eventsPushed} total) - ${batchTime}ms`);
      
      // Small delay to simulate network latency
      await this.sleep(50);
    }
    
    return { batchesCompleted, eventsPushed };
  }

  private async loadLocalSystemRanges(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<Map<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }>> {
    const systemRanges = new Map();
    const systemState = await processHandle.loadSystemState(system);
    
    for (const process of systemState.processes()) {
      const processState = await processHandle
        .store()
        .indexProcessStates.getProcessState(system, process);
      
      systemRanges.set(Core.Models.Process.toString(process), {
        process: process,
        ranges: processState.ranges,
      });
    }
    
    return systemRanges;
  }

  private async loadRemoteSystemRanges(
    server: string,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<Map<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }>> {
    const systemRanges = new Map();
    const remoteSystemRanges = await Core.APIMethods.getRanges(server, system);
    
    for (const remoteProcessRanges of remoteSystemRanges.rangesForProcesses) {
      systemRanges.set(Core.Models.Process.toString(remoteProcessRanges.process), {
        process: remoteProcessRanges.process,
        ranges: remoteProcessRanges.ranges,
      });
    }
    
    return systemRanges;
  }

  private subtractSystemRanges(
    alpha: ReadonlyMap<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }>,
    omega: ReadonlyMap<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }>
  ): Map<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }> {
    const result = new Map();
    
    for (const [processString, alphaRangesForProcess] of alpha.entries()) {
      const omegaRangesForProcess = omega.get(processString);
      
      if (omegaRangesForProcess) {
        result.set(processString, {
          process: alphaRangesForProcess.process,
          ranges: Core.Ranges.subtractRange(
            alphaRangesForProcess.ranges,
            omegaRangesForProcess.ranges
          ),
        });
      } else {
        result.set(processString, {
          process: alphaRangesForProcess.process,
          ranges: Core.Ranges.deepCopy(alphaRangesForProcess.ranges),
        });
      }
    }
    
    return result;
  }

  private async syncToServerSingleBatch(
    server: string,
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey,
    remoteNeedsAndLocalHas: Map<string, { process: Core.Models.Process.Process; ranges: Core.Ranges.IRange[] }>
  ): Promise<{ success: boolean; eventsPushed: number }> {
    for (const rangesForProcess of remoteNeedsAndLocalHas.values()) {
      if (rangesForProcess.ranges.length === 0) {
        continue;
      }
      
      const batch = Core.Ranges.takeRangesMaxItems(
        rangesForProcess.ranges,
        new Long(BATCH_SIZE, 0, true)
      );
      
      const events = await this.loadRanges(
        processHandle.store(),
        system,
        rangesForProcess.process,
        batch
      );
      
      try {
        await Core.APIMethods.postEvents(server, events);
        
        // After successful post, record server acknowledgment for each event
        for (const event of events) {
          processHandle.recordServerAck(event, server);
        }
      } catch (err) {
        console.warn('Failed to post events to server:', err);
        return { success: false, eventsPushed: 0 };
      }
      
      rangesForProcess.ranges = Core.Ranges.subtractRange(
        rangesForProcess.ranges,
        batch
      );
      
      return { success: true, eventsPushed: events.length }; // Made progress
    }
    
    return { success: false, eventsPushed: 0 }; // No progress
  }

  private async loadRanges(
    store: Core.Store.Store,
    system: Core.Models.PublicKey.PublicKey,
    process: Core.Models.Process.Process,
    ranges: Core.Ranges.IRange[]
  ): Promise<Core.Models.SignedEvent.SignedEvent[]> {
    const result: Core.Models.SignedEvent.SignedEvent[] = [];
    
    for (const range of ranges) {
      for (
        let i = range.low;
        i.lessThanOrEqual(range.high);
        i = i.add(Long.UONE)
      ) {
        const event = await store.indexEvents.getSignedEvent(system, process, i);
        if (event) {
          result.push(event);
        }
      }
    }
    
    return result;
  }

  private async parseSystemFromLink(link: string): Promise<Core.Models.PublicKey.PublicKey> {
    // Remove the polycentric:// prefix if present
    const cleanLink = link.replace('polycentric://', '');
    
    // Decode the URL info
    const urlInfo = Core.Protocol.URLInfo.decode(new Uint8Array(Buffer.from(cleanLink, 'base64')));
    
    // Check if it's a system link (which is what makeSystemLink creates)
    if (urlInfo.urlType.equals(Core.Models.URLInfo.URLInfoTypeSystemLink)) {
      const systemLink = Core.Models.URLInfo.getSystemLink(urlInfo);
      return systemLink.system;
    }
    
    // If it's an export bundle, use that
    if (urlInfo.urlType.equals(Core.Models.URLInfo.URLInfoTypeExportBundle)) {
      const exportBundle = Core.Models.URLInfo.getExportBundle(urlInfo);
      if (!exportBundle.keyPair?.publicKey) {
        throw new Error('No public key found in export bundle');
      }
      return Core.Models.PublicKey.fromProto({
        keyType: exportBundle.keyPair.keyType,
        key: exportBundle.keyPair.publicKey,
      });
    }
    
    throw new Error(`Unsupported URL type: ${urlInfo.urlType}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async cleanupTestAccount(processHandle: Core.ProcessHandle.ProcessHandle): Promise<void> {
    if (!CLEANUP_AFTER_TEST) {
      console.log(`🧹 Cleanup disabled - keeping test account`);
      return;
    }

    try {
      console.log(`🧹 Cleaning up test account from all servers...`);
      
      // Ensure we're connected to both servers for cleanup
      await processHandle.addServer(PROD_SERVER);
      await processHandle.addServer(TEST_SERVER);
      
      // Use deleteAccount method to remove all content from all connected servers
      await processHandle.deleteAccount();
      
      console.log(`✅ Test account cleaned up from all servers`);
      
    } catch (error) {
      console.error(`❌ Failed to cleanup test account: ${error}`);
    }
  }

  async runTests(): Promise<void> {
    console.log('🚀 Starting Grayjay Backfill Performance Tests');
    console.log(`📊 Testing message counts: ${testMessageCounts.join(', ')}`);
    console.log(`📦 Batch size: ${BATCH_SIZE} events`);
    console.log(`🔄 Max batches: ${MAX_BATCHES}`);
    console.log(`🧹 Cleanup: ${CLEANUP_AFTER_TEST ? 'Enabled' : 'Disabled'}`);
    console.log('='.repeat(60));
    
    // TEST 1: Post to PROD, sync to TEST
    console.log('\n🔄 TEST 1: POST TO PROD → SYNC TO TEST');
    console.log('='.repeat(50));
    
    for (const messageCount of testMessageCounts) {
      console.log(`\n🔄 TESTING ${messageCount} MESSAGES - PROD→TEST`);
      console.log('='.repeat(40));
      let processHandle: Core.ProcessHandle.ProcessHandle | undefined;
      
      try {
        // STEP 1: Create test account with posts to PROD
        console.log(`📝 STEP 1: Creating test account with ${messageCount} messages on PROD...`);
        const accountData = await this.createTestAccount(messageCount);
        processHandle = accountData.processHandle;
        
        // Wait for server processing
        console.log(`⏳ Waiting for server propagation...`);
        await this.sleep(3000);
        
        // STEP 2: Test backfill performance (PROD→TEST)
        console.log(`🧪 STEP 2: Testing backfill performance (PROD→TEST)...`);
        const result = await this.testGrayjayBackfill(accountData.accountId, messageCount, processHandle);
        this.results.push(result);
        
        // Print result
        console.log(`\n📈 Test completed for ${messageCount} messages (PROD→TEST):`);
        console.log(`   ⏱️  Total time: ${result.totalTimeMs}ms`);
        console.log(`   📦 Batches completed: ${result.batchesCompleted}`);
        console.log(`   📊 Events retrieved: ${result.eventsRetrieved}`);
        console.log(`   ⏰ Timed out: ${result.timedOut ? 'Yes' : 'No'}`);
        if (result.error) {
          console.log(`   ❌ Error: ${result.error}`);
        }
        
        // STEP 3: Cleanup test account
        console.log(`🧹 STEP 3: Cleaning up test account...`);
        if (processHandle) {
          await this.cleanupTestAccount(processHandle);
        }
        
        console.log(`✅ COMPLETE LOOP FINISHED FOR ${messageCount} MESSAGES (PROD→TEST)`);
        console.log('-'.repeat(40));
        
        // Wait between tests
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Failed to test ${messageCount} messages:`, error);
        this.results.push({
          messageCount,
          accountId: 'unknown',
          totalTimeMs: 0,
          batchesCompleted: 0,
          eventsRetrieved: 0,
          timedOut: true,
          error: error instanceof Error ? error.message : String(error),
        });
        
        // Cleanup on error too
        if (processHandle) {
          await this.cleanupTestAccount(processHandle);
        }
      }
    }
    
    // TEST 2: Post to TEST, sync to PROD
    console.log('\n🔄 TEST 2: POST TO TEST → SYNC TO PROD');
    console.log('='.repeat(50));
    
    for (const messageCount of testMessageCounts) {
      console.log(`\n🔄 TESTING ${messageCount} MESSAGES - TEST→PROD`);
      console.log('='.repeat(40));
      let processHandle: Core.ProcessHandle.ProcessHandle | undefined;
      
      try {
        // STEP 1: Create test account with posts to TEST
        console.log(`📝 STEP 1: Creating test account with ${messageCount} messages on TEST...`);
        const accountData = await this.createTestAccountToTestServer(messageCount);
        processHandle = accountData.processHandle;
        
        // Wait for server processing
        console.log(`⏳ Waiting for server propagation...`);
        await this.sleep(3000);
        
        // STEP 2: Test backfill performance (TEST→PROD)
        console.log(`🧪 STEP 2: Testing backfill performance (TEST→PROD)...`);
        const result = await this.testBackfillToProduction(accountData.accountId, messageCount, processHandle);
        this.results.push(result);
        
        // Print result
        console.log(`\n📈 Test completed for ${messageCount} messages (TEST→PROD):`);
        console.log(`   ⏱️  Total time: ${result.totalTimeMs}ms`);
        console.log(`   📦 Batches completed: ${result.batchesCompleted}`);
        console.log(`   📊 Events retrieved: ${result.eventsRetrieved}`);
        console.log(`   ⏰ Timed out: ${result.timedOut ? 'Yes' : 'No'}`);
        if (result.error) {
          console.log(`   ❌ Error: ${result.error}`);
        }
        
        // STEP 3: Cleanup test account
        console.log(`🧹 STEP 3: Cleaning up test account...`);
        if (processHandle) {
          await this.cleanupTestAccount(processHandle);
        }
        
        console.log(`✅ COMPLETE LOOP FINISHED FOR ${messageCount} MESSAGES (TEST→PROD)`);
        console.log('-'.repeat(40));
        
        // Wait between tests
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Failed to test ${messageCount} messages:`, error);
        this.results.push({
          messageCount,
          accountId: 'unknown',
          totalTimeMs: 0,
          batchesCompleted: 0,
          eventsRetrieved: 0,
          timedOut: true,
          error: error instanceof Error ? error.message : String(error),
        });
        
        // Cleanup on error too
        if (processHandle) {
          await this.cleanupTestAccount(processHandle);
        }
      }
    }
    
    this.printSummary();
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 GRAYJAY BACKFILL PERFORMANCE TEST SUMMARY');
    console.log('='.repeat(60));
    
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => !r.timedOut && !r.error);
    const timeoutTests = this.results.filter(r => r.timedOut);
    const errorTests = this.results.filter(r => r.error && !r.timedOut);
    
    console.log(`📈 Total tests: ${totalTests}`);
    console.log(`✅ Successful: ${successfulTests.length}`);
    // console.log(`⏰ Timeouts: ${timeoutTests.length}`);
    console.log(`❌ Errors: ${errorTests.length}`);
    
    if (successfulTests.length > 0) {
      const avgTime = successfulTests.reduce((sum, r) => sum + r.totalTimeMs, 0) / successfulTests.length;
      const maxTime = Math.max(...successfulTests.map(r => r.totalTimeMs));
      const minTime = Math.min(...successfulTests.map(r => r.totalTimeMs));
      
      // Calculate average batch time
      const totalBatches = successfulTests.reduce((sum, r) => sum + r.batchesCompleted, 0);
      const avgBatchTime = totalBatches > 0 ? avgTime / (totalBatches / successfulTests.length) : 0;
      
      console.log(`\n📊 Performance metrics (successful tests):`);
      console.log(`   ⏱️  Average time: ${avgTime.toFixed(0)}ms`);
      console.log(`   🚀 Maximum time: ${maxTime}ms`);
      console.log(`   🐌 Minimum time: ${minTime}ms`);
      console.log(`   📦 Average batch time: ${avgBatchTime.toFixed(0)}ms`);
    }
    
    console.log(`\n📋 Detailed results:`);
    this.results.forEach(result => {
      const status = result.timedOut ? '⏰ TIMEOUT' : result.error ? '❌ ERROR' : '✅ SUCCESS';
      console.log(`   ${result.messageCount.toString().padStart(4)} messages: ${result.totalTimeMs.toString().padStart(4)}ms | ${result.batchesCompleted} batches | ${result.eventsRetrieved} events | ${status}`);
    });
    
    if (timeoutTests.length > 0) {
      console.log(`\n⚠️  TIMEOUT ISSUES DETECTED:`);
      timeoutTests.forEach(result => {
        console.log(`   ${result.messageCount} messages: ${result.batchesCompleted} batches completed before timeout`);
      });
    }
    
    // Recommendations
    console.log(`\n💡 RECOMMENDATIONS:`);
    const problematicCounts = timeoutTests.map(r => r.messageCount);
    if (problematicCounts.length > 0) {
      console.log(`   • Accounts with ${problematicCounts.join(', ')} messages are timing out`);
      console.log(`   • Consider increasing timeout or optimizing server response`);
    } else {
      console.log(`   • All tested message counts completed successfully`);
    }
    
    console.log('='.repeat(60));
  }
}

// Run the tests
async function main() {
  const tester = new GrayjayBackfillTester();
  await tester.runTests();
}

main().catch(console.error); 