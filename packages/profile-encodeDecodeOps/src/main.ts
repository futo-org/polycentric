import './style.css';
import {
  Models,
  PersistenceDriver,
  Store,
  ProcessHandle,
  Protocol,
} from 'polycentric-core';

// --- DOM Elements ---
const app = document.querySelector<HTMLDivElement>('#app')!;
const runTestBtn = document.querySelector<HTMLButtonElement>('#runTestBtn')!;
const resultsDiv = document.querySelector<HTMLPreElement>('#results')!;

// --- Helper to display results ---
function displayResult(message: string, data?: any) {
  resultsDiv.textContent =
    message + (data ? `\n\n${JSON.stringify(data, null, 2)}` : '');
}

/**
 * The core logic for creating, encoding, and decoding an event.
 * Adapted for browser environment.
 */
async function runTestLogic(): Promise<{
  encodeMs: number;
  decodeMs: number;
  reEncodeMs: number;
  success: boolean;
  message: string;
}> {
  console.log('\n--- Running Test Logic ---');
  displayResult('Running test logic...');

  let processHandle: ProcessHandle.ProcessHandle;
  let originalSignedEvent: Models.SignedEvent.SignedEvent | undefined | null =
    null;
  let encodedEventBytes: Uint8Array | undefined;
  let decodedSignedEvent: Models.SignedEvent.SignedEvent | null = null;
  let reEncodedBytes: Uint8Array | null = null;

  let encodeStart = 0,
    encodeEnd = 0,
    decodeStart = 0,
    decodeEnd = 0,
    reEncodeStart = 0,
    reEncodeEnd = 0;
  let success = false;
  let message = '';

  try {
    // Setup
    // Note: In browser, we might need a different driver (e.g., IndexedDB) for actual persistence,
    // but for this profiling test, the in-memory driver should work fine.
    const driver = PersistenceDriver.createPersistenceDriverMemory();
    const level = await driver.openStore('profiler-store-vite');
    const store = new Store.Store(level);
    processHandle = await ProcessHandle.createTestProcessHandle();
    console.log(`ProcessHandle created.`);

    // 1. Create Event
    const skillClaimProto = Models.claimSkill('Vite Test Profiling');
    const pointer = await processHandle.claim(skillClaimProto);
    originalSignedEvent = await processHandle
      .store()
      .indexEvents.getSignedEvent(
        pointer.system,
        pointer.process,
        pointer.logicalClock,
      );
    if (!originalSignedEvent)
      throw new Error('Failed to retrieve created event.');
    console.log('Event Created.');

    // 2. Encode Event
    encodeStart = performance.now();
    encodedEventBytes =
      Protocol.SignedEvent.encode(originalSignedEvent).finish();
    encodeEnd = performance.now();
    if (!encodedEventBytes || encodedEventBytes.length === 0)
      throw new Error('Encoding failed.');
    console.log(`Event Encoded (${encodedEventBytes.length} bytes).`);

    // 3. Decode Event
    decodeStart = performance.now();
    const decodedProto = Protocol.SignedEvent.decode(encodedEventBytes);
    decodedSignedEvent = Models.SignedEvent.fromProto(decodedProto);
    decodeEnd = performance.now();
    if (!decodedSignedEvent) throw new Error('Decoding failed.');
    console.log('Event Decoded.');

    // 4. Verification Re-encode
    reEncodeStart = performance.now();
    reEncodedBytes = Protocol.SignedEvent.encode(decodedSignedEvent).finish();
    reEncodeEnd = performance.now();

    // 5. Verify
    if (
      reEncodedBytes &&
      encodedEventBytes.length === reEncodedBytes.length &&
      encodedEventBytes.every((byte, index) => byte === reEncodedBytes![index])
    ) {
      success = true;
      message = 'SUCCESS: Encode/Decode/Verify complete.';
      console.log(message);
    } else {
      message = 'FAILURE: Verification check failed.';
      console.error(message);
      console.log(
        'Original length:',
        encodedEventBytes.length,
        'Re-encoded length:',
        reEncodedBytes?.length,
      );
    }
  } catch (error: any) {
    message = `Error during test logic: ${error.message}`;
    console.error(message, error);
    success = false;
  }
  console.log('--- Test Logic Finished ---');

  const resultData = {
    encodeMs: encodeEnd - encodeStart,
    decodeMs: decodeEnd - decodeStart,
    reEncodeMs: reEncodeEnd - reEncodeStart,
    success,
    message,
  };
  displayResult(message, resultData);
  return resultData;
}

// --- Event Listener ---
if (runTestBtn) {
  runTestBtn.addEventListener('click', async () => {
    runTestBtn.disabled = true;
    displayResult('Starting test...');
    try {
      console.profile('EncodeDecodeProfile'); // Start profiling
      await runTestLogic();
      console.profileEnd('EncodeDecodeProfile'); // End profiling
    } catch (err: any) {
      console.error('Error in button click handler:', err);
      displayResult(`Error: ${err.message}`);
    } finally {
      runTestBtn.disabled = false;
    }
  });
} else {
  console.error('Could not find #runTestBtn');
  if (app) app.innerHTML += '<p>Error: Button not found!</p>';
}
