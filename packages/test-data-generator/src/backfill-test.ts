import * as Core from '@polycentric/polycentric-core';
import Long from 'long';

// Server URLs
const PROD_SERVER = 'https://srv1-prod.polycentric.io';
const TEST_SERVER = 'https://grayjay-srv1-test.polycentric.io';

// Test configurations
const MESSAGE_COUNTS = [10, 50, 100, 200, 500, 1000];
const TIMEOUT_MS = 3000; // 3 seconds to match Grayjay timeout

interface TestResult {
  messageCount: number;
  accountId: string;
  backfillTimeMs: number;
  success: boolean;
  error?: string;
  eventsRetrieved: number;
}

class BackfillTester {
  private results: TestResult[] = [];

  async createTestAccount(messageCount: number): Promise<{
    processHandle: Core.ProcessHandle.ProcessHandle;
    accountId: string;
  }> {
    console.log(`Creating test account with ${messageCount} messages...`);
    
    const processHandle = await Core.ProcessHandle.createProcessHandle(
      await Core.MetaStore.createMetaStore(
        Core.PersistenceDriver.createPersistenceDriverMemory(),
      ),
    );

    // Add production server
    await processHandle.addServer(PROD_SERVER);
    
    // Set a unique username
    const username = `backfill_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await processHandle.setUsername(username);
    
    // Create messages
    for (let i = 0; i < messageCount; i++) {
      await processHandle.post(`Test message ${i + 1} for backfill testing`);
    }
    
    // Sync to production server
    console.log(`Syncing ${messageCount} messages to production server...`);
    await Core.Synchronization.backFillServers(processHandle, processHandle.system());
    
    // Wait a bit for server processing
    await this.sleep(2000);
    
    const accountId = await Core.ProcessHandle.makeSystemLink(processHandle, processHandle.system());
    
    return { processHandle, accountId };
  }

  async testBackfillPerformance(accountId: string, messageCount: number): Promise<TestResult> {
    console.log(`Testing backfill for account with ${messageCount} messages...`);
    
    const startTime = Date.now();
    let success = false;
    let error: string | undefined;
    let eventsRetrieved = 0;
    
    try {
      // Create a new process handle to simulate a fresh client
      const testHandle = await Core.ProcessHandle.createProcessHandle(
        await Core.MetaStore.createMetaStore(
          Core.PersistenceDriver.createPersistenceDriverMemory(),
        ),
      );
      
      // Add test server
      await testHandle.addServer(TEST_SERVER);
      
      // Parse the account ID to get the system
      const system = await this.parseSystemFromLink(accountId);
      
      // Set up timeout for the backfill operation
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Backfill timeout')), TIMEOUT_MS);
      });
      
      // Perform backfill with timeout
      const backfillPromise = this.performBackfill(testHandle, system);
      
      await Promise.race([backfillPromise, timeoutPromise]);
      
      // Count retrieved events
      eventsRetrieved = await this.countRetrievedEvents(testHandle, system);
      
      success = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`Backfill failed for ${messageCount} messages:`, error);
    }
    
    const backfillTimeMs = Date.now() - startTime;
    
    return {
      messageCount,
      accountId,
      backfillTimeMs,
      success,
      error,
      eventsRetrieved,
    };
  }

  private async performBackfill(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<void> {
    // Get ranges from server
    const ranges = await Core.APIMethods.getRanges(TEST_SERVER, system);
    
    if (ranges.rangesForProcesses.length === 0) {
      console.log('No events found on server');
      return;
    }
    
    // Create ranges for system
    const rangesForSystem = Core.Models.Ranges.rangesForSystemFromProto({
      rangesForProcesses: ranges.rangesForProcesses,
    });
    
    // Get events in batches (similar to Grayjay's 10-event limit)
    const batchSize = 10;
    let totalRetrieved = 0;
    
    for (const processRange of ranges.rangesForProcesses) {
      const process = Core.Models.Process.fromProto(processRange.process);
      
      for (const range of processRange.ranges) {
        const eventsInRange = range.high.subtract(range.low).add(Long.UONE).toNumber();
        const batches = Math.ceil(eventsInRange / batchSize);
        
        for (let i = 0; i < batches; i++) {
          const batchStart = range.low.add(Long.fromNumber(i * batchSize, true));
          const batchEnd = batchStart.add(Long.fromNumber(batchSize - 1, true)).greaterThan(range.high) 
            ? range.high 
            : batchStart.add(Long.fromNumber(batchSize - 1, true));
          
          const batchRanges = Core.Models.Ranges.rangesForSystemFromProto({
            rangesForProcesses: [{
              process: processRange.process,
              ranges: [{
                low: batchStart,
                high: batchEnd,
              }],
            }],
          });
          
          const events = await Core.APIMethods.getEvents(TEST_SERVER, system, batchRanges);
          
          // Ingest events
          for (const event of events.events) {
            await processHandle.ingest(event);
          }
          
          totalRetrieved += events.events.length;
          console.log(`Retrieved batch ${i + 1}/${batches} (${events.events.length} events)`);
        }
      }
    }
    
    console.log(`Total events retrieved: ${totalRetrieved}`);
  }

  private async countRetrievedEvents(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey
  ): Promise<number> {
    const store = processHandle.store();
    const systemState = await processHandle.loadSystemState(system);
    let totalEvents = 0;
    
    for (const process of systemState.processes()) {
      const processState = await store.indexProcessStates.getProcessState(system, process);
      totalEvents += processState.ranges.reduce((sum, range) => {
        return sum + range.high.subtract(range.low).add(Long.UONE).toNumber();
      }, 0);
    }
    
    return totalEvents;
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

  async runTests(): Promise<void> {
    console.log('Starting backfill performance tests...');
    console.log(`Testing message counts: ${MESSAGE_COUNTS.join(', ')}`);
    console.log(`Timeout: ${TIMEOUT_MS}ms`);
    console.log('---');
    
    for (const messageCount of MESSAGE_COUNTS) {
      try {
        // Create test account
        const { accountId } = await this.createTestAccount(messageCount);
        
        // Wait a bit for server processing
        await this.sleep(5000);
        
        // Test backfill performance
        const result = await this.testBackfillPerformance(accountId, messageCount);
        this.results.push(result);
        
        console.log(`Test completed for ${messageCount} messages:`);
        console.log(`  Time: ${result.backfillTimeMs}ms`);
        console.log(`  Success: ${result.success}`);
        console.log(`  Events retrieved: ${result.eventsRetrieved}`);
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
        console.log('---');
        
        // Wait between tests to avoid overwhelming servers
        await this.sleep(3000);
        
      } catch (error) {
        console.error(`Failed to test ${messageCount} messages:`, error);
        this.results.push({
          messageCount,
          accountId: 'unknown',
          backfillTimeMs: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          eventsRetrieved: 0,
        });
      }
    }
    
    this.printSummary();
  }

  private printSummary(): void {
    console.log('\n=== BACKFILL PERFORMANCE TEST SUMMARY ===');
    console.log(`Total tests: ${this.results.length}`);
    
    const successfulTests = this.results.filter(r => r.success);
    const failedTests = this.results.filter(r => !r.success);
    
    console.log(`Successful: ${successfulTests.length}`);
    console.log(`Failed: ${failedTests.length}`);
    
    if (successfulTests.length > 0) {
      const avgTime = successfulTests.reduce((sum, r) => sum + r.backfillTimeMs, 0) / successfulTests.length;
      const maxTime = Math.max(...successfulTests.map(r => r.backfillTimeMs));
      const minTime = Math.min(...successfulTests.map(r => r.backfillTimeMs));
      
      console.log(`\nPerformance metrics (successful tests):`);
      console.log(`  Average time: ${avgTime.toFixed(2)}ms`);
      console.log(`  Maximum time: ${maxTime}ms`);
      console.log(`  Minimum time: ${minTime}ms`);
      
      console.log(`\nDetailed results:`);
      successfulTests.forEach(result => {
        console.log(`  ${result.messageCount} messages: ${result.backfillTimeMs}ms (${result.eventsRetrieved} events)`);
      });
    }
    
    if (failedTests.length > 0) {
      console.log(`\nFailed tests:`);
      failedTests.forEach(result => {
        console.log(`  ${result.messageCount} messages: ${result.error}`);
      });
    }
    
    // Check for timeout issues
    const timeoutTests = this.results.filter(r => r.error?.includes('timeout'));
    if (timeoutTests.length > 0) {
      console.log(`\n⚠️  TIMEOUT ISSUES DETECTED:`);
      timeoutTests.forEach(result => {
        console.log(`  ${result.messageCount} messages timed out after ${TIMEOUT_MS}ms`);
      });
    }
    
    console.log('\n=== END SUMMARY ===');
  }
}

// Run the tests
async function main() {
  const tester = new BackfillTester();
  await tester.runTests();
}

main().catch(console.error); 