import * as flatbuffers from 'flatbuffers';
import { Perf } from './perf-test_generated.ts'; // Import the top-level namespace
// Directly get Event and SignedEvent from the namespace
const Event = Perf.Test.Event;
const SignedEvent = Perf.Test.SignedEvent;

// Assuming counter setup and logos are not needed for the benchmark
// import { setupCounter } from './counter.ts';
import './style.css';
// import typescriptLogo from './typescript.svg';
// import viteLogo from '/vite.svg';

// Get UI elements
const appDiv = document.getElementById('app'); // Assuming the structure from index.html
const runTestBtn = document.getElementById('runTestBtn');
const resultsPre = document.getElementById('results');

// Check if elements exist right after getting them
if (!appDiv || !runTestBtn || !resultsPre) {
    throw new Error('Required HTML elements not found! Could not find app, runTestBtn, or results.');
}

// --- Mock Data Generation ---
function generateMockEventData(size: number) {
    return {
        systemId: new Uint8Array(32).fill(1),
        timestamp: BigInt(Date.now()),
        content: 'x'.repeat(size)
    };
}

function generateMockSignedEventData(contentSize: number) {
    return {
        signature: new Uint8Array(64).fill(2),
        event: generateMockEventData(contentSize)
    };
}

// --- Benchmark Logic ---
async function runBenchmark() {
    resultsPre!.textContent = 'Running benchmark...';
    runTestBtn!.setAttribute('disabled', 'true');
    await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI update

    const iterations = 10000;
    const contentSizes = [10, 100, 1000, 10000];
    let outputLog = "FlatBuffers Benchmark Results:\n=============================\n";

    try {
        for (const size of contentSizes) {
            outputLog += `\n--- Content size: ${size} ---\n`;
            const mockData = generateMockSignedEventData(size);
            let encodedBuffer: Uint8Array | null = null;

            // Warm-up (optional, but good practice)
            {
                const builder = new flatbuffers.Builder(1);
                const signatureOffset = SignedEvent.createSignatureVector(builder, mockData.signature);
                const systemIdVecOffset = Event.createSystemIdVector(builder, mockData.event.systemId);
                const contentOffset = builder.createString(mockData.event.content);
                Event.startEvent(builder);
                Event.addSystemId(builder, systemIdVecOffset);
                Event.addTimestamp(builder, mockData.event.timestamp);
                Event.addContent(builder, contentOffset);
                const eventOffset = Event.endEvent(builder);
                SignedEvent.startSignedEvent(builder);
                SignedEvent.addSignature(builder, signatureOffset);
                SignedEvent.addEvent(builder, eventOffset);
                const signedEventOffset = SignedEvent.endSignedEvent(builder);
                builder.finish(signedEventOffset);
                encodedBuffer = builder.asUint8Array();
                const buf = new flatbuffers.ByteBuffer(encodedBuffer!);
                SignedEvent.getRootAsSignedEvent(buf);
            }

            // --- Encoding Test ---
            const encodeStart = performance.now();
            for (let i = 0; i < iterations; i++) {
                const builder = new flatbuffers.Builder(1024); // Start relatively small
                const signatureOffset = SignedEvent.createSignatureVector(builder, mockData.signature);
                const systemIdVecOffset = Event.createSystemIdVector(builder, mockData.event.systemId);
                const contentOffset = builder.createString(mockData.event.content);
                Event.startEvent(builder);
                Event.addSystemId(builder, systemIdVecOffset);
                Event.addTimestamp(builder, mockData.event.timestamp);
                Event.addContent(builder, contentOffset);
                const eventOffset = Event.endEvent(builder);
                SignedEvent.startSignedEvent(builder);
                SignedEvent.addSignature(builder, signatureOffset);
                SignedEvent.addEvent(builder, eventOffset);
                const signedEventOffset = SignedEvent.endSignedEvent(builder);
                builder.finish(signedEventOffset);
                encodedBuffer = builder.asUint8Array(); // Get the buffer for decode test
            }
            const encodeTime = performance.now() - encodeStart;

            if (!encodedBuffer) {
                outputLog += `  Encoding failed!\n`;
                continue;
            }
            outputLog += `  Encode Time : ${(encodeTime / iterations).toFixed(6)} ms/op\n`;
            outputLog += `  Buffer Size : ${encodedBuffer.length} bytes\n`;

            // --- Decoding (Access) Test ---
            const decodeStart = performance.now();
            for (let i = 0; i < iterations; i++) {
                const buf = new flatbuffers.ByteBuffer(encodedBuffer!); // Pass the buffer created during encoding
                const decoded = SignedEvent.getRootAsSignedEvent(buf);
                // Access all fields to ensure work is done (simulates decoding cost)
                const sig = decoded.signatureArray();
                const event = decoded.event();
                if (event) {
                    const sysId = event.systemIdArray();
                    const ts = event.timestamp();
                    const content = event.content();
                    // Minimal check to prevent dead code elimination
                    if (!sig || !sysId || !ts || !content) {
                        console.warn("Missing data during access");
                   }
                } else {
                    console.warn("Missing event during access");
                }
            }
            const decodeTime = performance.now() - decodeStart;
            outputLog += `  Decode Time : ${(decodeTime / iterations).toFixed(6)} ms/op\n`;
        }
        outputLog += "\nBenchmark finished.\n";
    } catch (error) {
        outputLog += `\nError during benchmark: ${error instanceof Error ? error.message : String(error)}\n`;
        console.error(error);
    }

    resultsPre!.textContent = outputLog;
    runTestBtn!.removeAttribute('disabled');
}

// --- Event Listener ---
runTestBtn!.addEventListener('click', runBenchmark);

// --- Initial State ---
// Remove the placeholder code for clearing default content
// const defaultContent = appDiv.querySelector('div');
// if (defaultContent && defaultContent.parentElement === appDiv) {
//   // ...
// }

// Set initial message (no need to check for null)
resultsPre!.textContent = 'Click "Run Benchmark" to start.';
