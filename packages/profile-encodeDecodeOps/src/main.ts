import {
  Models,
  PersistenceDriver,
  ProcessHandle,
  Protocol,
  Store,
} from 'polycentric-core';
import './style.css';

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
  avgEncodeMs: number;
  avgDecodeMs: number;
  avgReEncodeMs: number;
  totalIterations: number;
  message: string;
}> {
  console.log('\n--- Running Test Logic (10,000 iterations) ---');
  displayResult('Running 10,000 iterations...');
  
  const iterations = 10000;
  let totalEncodeTime = 0;
  let totalDecodeTime = 0;
  let totalReEncodeTime = 0;
  let processHandle: ProcessHandle.ProcessHandle;
  let originalSignedEvent: Models.SignedEvent.SignedEvent | undefined | null = null;
  let encodedEventBytes: Uint8Array | undefined = undefined;
  let successCount = 0;
  let finalMessage = '';

  try {
    const driver = PersistenceDriver.createPersistenceDriverMemory();
    const level = await driver.openStore('profiler-store-vite');
    const store = new Store.Store(level);
    processHandle = await ProcessHandle.createTestProcessHandle();
    const skillClaimProto = Models.claimSkill('Vite Test Profiling Iterations');
    const pointer = await processHandle.claim(skillClaimProto);
    originalSignedEvent = await processHandle.store().indexEvents.getSignedEvent(
        pointer.system,
        pointer.process,
        pointer.logicalClock,
      );
    if (!originalSignedEvent) throw new Error('Failed to create initial event.');
    console.log('Initial Event Created.');
    
    encodedEventBytes = Protocol.SignedEvent.encode(originalSignedEvent).finish();
    if (!encodedEventBytes || encodedEventBytes.length === 0) throw new Error('Initial encoding failed.');
    console.log(`Initial event encoded (${encodedEventBytes.length} bytes).`);

    const loopStart = performance.now();

    for (let i = 0; i < iterations; i++) {
        let currentEncodedBytes: Uint8Array | undefined = undefined;
        let decodedSignedEvent: Models.SignedEvent.SignedEvent | null = null;
        let reEncodedBytes: Uint8Array | null = null;
        let iterSuccess = false;

        const encodeStart = performance.now();
        currentEncodedBytes = Protocol.SignedEvent.encode(originalSignedEvent).finish();
        const encodeEnd = performance.now();
        totalEncodeTime += (encodeEnd - encodeStart);

        const decodeStart = performance.now();
        const decodedProto = Protocol.SignedEvent.decode(encodedEventBytes);
        decodedSignedEvent = Models.SignedEvent.fromProto(decodedProto);
        const decodeEnd = performance.now();
        totalDecodeTime += (decodeEnd - decodeStart);

        const reEncodeStart = performance.now();
        reEncodedBytes = Protocol.SignedEvent.encode(decodedSignedEvent).finish();
        const reEncodeEnd = performance.now();
        totalReEncodeTime += (reEncodeEnd - reEncodeStart);

        if (reEncodedBytes && encodedEventBytes.length === reEncodedBytes.length && 
            encodedEventBytes.every((byte, index) => byte === reEncodedBytes![index])) {
            iterSuccess = true;
            successCount++;
        } else {
        }
    }

    const loopEnd = performance.now();
    console.log(`Loop finished in ${loopEnd - loopStart} ms.`);

    if (successCount === iterations) {
      finalMessage = `SUCCESS: ${iterations} Encode/Decode/Verify iterations complete.`;
    } else {
      finalMessage = `FAILURE: Only ${successCount} / ${iterations} iterations verified successfully.`;
      console.error(finalMessage);
    }

  } catch (error: any) {
    finalMessage = `Error during test logic: ${error.message}`;
    console.error(finalMessage, error);
  }
  console.log('--- Test Logic Finished ---');

  const avgEncodeMs = totalEncodeTime / iterations;
  const avgDecodeMs = totalDecodeTime / iterations;
  const avgReEncodeMs = totalReEncodeTime / iterations;

  const resultData = {
    totalIterations: iterations,
    avgEncodeMs: avgEncodeMs,
    avgDecodeMs: avgDecodeMs,
    avgReEncodeMs: avgReEncodeMs,
    message: finalMessage,
    totalEncodeTime: totalEncodeTime,
    totalDecodeTime: totalDecodeTime,
    totalReEncodeTime: totalReEncodeTime,
  };
  
  let outputString = `${finalMessage}\n\nResults (${iterations} iterations):\n`;
  outputString += `-------------------------------------\n`;
  outputString += `Avg Encode Time : ${avgEncodeMs.toFixed(6)} ms/op (${totalEncodeTime.toFixed(3)} ms total)\n`;
  outputString += `Avg Decode Time : ${avgDecodeMs.toFixed(6)} ms/op (${totalDecodeTime.toFixed(3)} ms total)\n`;
  outputString += `Avg ReEncode Time: ${avgReEncodeMs.toFixed(6)} ms/op (${totalReEncodeTime.toFixed(3)} ms total)\n`;

  displayResult(outputString);

  return {
      avgEncodeMs,
      avgDecodeMs,
      avgReEncodeMs,
      totalIterations: iterations,
      message: finalMessage
  };
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
