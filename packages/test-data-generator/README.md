# Test Data Generator

This package contains tools for generating test data and testing Polycentric functionality.

## Backfill Performance Tests

This package includes two test scripts to diagnose timeout issues in the Grayjay Android app's backfill functionality:

### 1. Grayjay-Specific Backfill Test (`grayjay-backfill-test.ts`)

This is the **recommended test** as it exactly simulates Grayjay's behavior:
- Processes events in batches of 10 (like Grayjay does)
- Uses 3-second timeout per batch
- Limits total batches to prevent infinite loops
- Provides detailed timing and batch-level analysis

### 2. General Backfill Test (`backfill-test.ts`)

A more general test that measures overall backfill performance without the specific Grayjay constraints.

### What it does:

1. **Creates test accounts** with varying numbers of messages (10, 50, 100, 200, 500, 1000)
2. **Posts messages to production server** (`https://srv1-prod.polycentric.io`)
3. **Tests backfill performance** on the test server (`https://grayjay-srv1-test.polycentric.io`) with a 3-second timeout
4. **Measures and reports** timing data to identify where timeouts occur

### How to run:

**Recommended (Grayjay-specific test):**
```bash
cd packages/test-data-generator
npm run grayjay-test
```

**General backfill test:**
```bash
cd packages/test-data-generator
npm run backfill-test
```

### What to look for:

The script will output detailed timing information and identify:
- Which message counts cause timeouts
- How long backfill takes for different account sizes
- Whether the 3-second timeout is sufficient
- Performance bottlenecks in the backfill process

### Expected output (Grayjay test):

```
🚀 Starting Grayjay Backfill Performance Tests
📊 Testing message counts: 10, 20, 50, 100, 200, 500, 1000
⏱️  Timeout per batch: 3000ms
📦 Batch size: 10 events
🔄 Max batches: 10
============================================================

🔄 Creating test account with 10 messages...
📝 Creating 10 messages...
📤 Syncing to production server...
⏳ Waiting for server processing...
✅ Account created: polycentric://...

🧪 Testing Grayjay-style backfill for 10 messages...
📊 Getting event ranges from server...
📦 Processing 10 events in 1 batches of 10...
🔄 Batch 1/1: events 1 to 10
✅ Batch 1 completed: 10 events (10 total)

📈 Test completed for 10 messages:
   ⏱️  Total time: 1200ms
   📦 Batches completed: 1
   📊 Events retrieved: 10
   ⏰ Timed out: No
----------------------------------------

============================================================
📊 GRAYJAY BACKFILL PERFORMANCE TEST SUMMARY
============================================================
📈 Total tests: 7
✅ Successful: 4
⏰ Timeouts: 3
❌ Errors: 0

📊 Performance metrics (successful tests):
   ⏱️  Average time: 1500ms
   🚀 Maximum time: 2800ms
   🐌 Minimum time: 1200ms

📋 Detailed results:
     10 messages: 1200ms | 1 batches | 10 events | ✅ SUCCESS
     20 messages: 1500ms | 2 batches | 20 events | ✅ SUCCESS
     50 messages: 2000ms | 5 batches | 50 events | ✅ SUCCESS
    100 messages: 2800ms | 10 batches | 100 events | ✅ SUCCESS
    200 messages:    0ms | 0 batches | 0 events | ⏰ TIMEOUT
    500 messages:    0ms | 0 batches | 0 events | ⏰ TIMEOUT
   1000 messages:    0ms | 0 batches | 0 events | ⏰ TIMEOUT

⚠️  TIMEOUT ISSUES DETECTED:
   200 messages: 0 batches completed before timeout
   500 messages: 0 batches completed before timeout
   1000 messages: 0 batches completed before timeout

💡 RECOMMENDATIONS:
   • Accounts with 200, 500, 1000 messages are timing out
   • Consider increasing timeout from 3000ms or optimizing server response
============================================================
```

### Troubleshooting:

If you encounter issues:

1. **Network connectivity**: Ensure you can reach both production and test servers
2. **Server availability**: Check if the servers are responding
3. **Rate limiting**: The script includes delays between tests to avoid overwhelming servers
4. **Dependencies**: Make sure all dependencies are installed with `npm install`

### Cleanup:

By default, the test script **automatically cleans up** test accounts after each test by deleting all content. This prevents test data from accumulating on the servers.

**To disable cleanup** (keep test accounts for inspection):
```bash
npm run grayjay-test -- --no-cleanup
```

**Note**: Test accounts are created with unique usernames like `grayjay_test_1234567890_abc123` to avoid conflicts.

### Customization:

You can customize the test in several ways:

**Command line options:**
```bash
npm run grayjay-test -- --quick              # Quick test with fewer messages
npm run grayjay-test -- --slow               # Slow test with more messages
npm run grayjay-test -- --timeout 5000       # Custom timeout
npm run grayjay-test -- --batch-size 5       # Smaller batch size
npm run grayjay-test -- --no-cleanup         # Keep test accounts
```

**Environment variables:**
```bash
TIMEOUT_MS=5000 BATCH_SIZE=5 npm run grayjay-test
```

**Direct file modification:**
- `MESSAGE_COUNTS`: Array of message counts to test
- `TIMEOUT_MS`: Timeout duration (default: 3000ms to match Grayjay)
- `BATCH_SIZE`: Events per batch (default: 10 to match Grayjay)
- `MAX_BATCHES`: Maximum batches to process (default: 10)
- `PROD_SERVER` and `TEST_SERVER`: Server URLs to test against
- `CLEANUP_AFTER_TEST`: Set to `false` to disable cleanup

### Quick Start:

```bash
# Install dependencies
npm install

# Run quick test
npm run grayjay-test -- --quick

# Or use the example script
./example-run.sh
``` 