// Simple test runner for Polycentric React Native port
const fs = require('fs');
const path = require('path');

// Mock react-native-mmkv
class MockMMKV {
  constructor(options) {
    this.id = options?.id || 'default';
    this.store = new Map();
    console.log(`[MMKV] Created storage with ID: ${this.id}`);
  }
  
  set(key, value) {
    this.store.set(key, value);
    console.log(`[MMKV:${this.id}] Set key: ${key.substring(0, 20)}${key.length > 20 ? '...' : ''}`);
  }
  
  getString(key) {
    const value = this.store.get(key);
    console.log(`[MMKV:${this.id}] Get key: ${key.substring(0, 20)}${key.length > 20 ? '...' : ''} => ${value ? 'exists' : 'not found'}`);
    return value;
  }
  
  delete(key) {
    this.store.delete(key);
    console.log(`[MMKV:${this.id}] Delete key: ${key.substring(0, 20)}${key.length > 20 ? '...' : ''}`);
  }
  
  getAllKeys() {
    const keys = Array.from(this.store.keys());
    console.log(`[MMKV:${this.id}] GetAllKeys: ${keys.length} keys`);
    return keys;
  }
  
  clearAll() {
    const count = this.store.size;
    this.store.clear();
    console.log(`[MMKV:${this.id}] ClearAll: ${count} keys cleared`);
  }
}

// Store mock storage globally to enable cross-instance data sharing
global.__MMKV_STORAGE_MOCKS = new Map();

// Mock for react-native-mmkv
require.cache[require.resolve('react-native-mmkv')] = {
  exports: {
    MMKV: class {
      constructor(options) {
        this.id = options?.id || 'default';
        
        // Reuse existing mock if available for the same ID
        if (!global.__MMKV_STORAGE_MOCKS.has(this.id)) {
          global.__MMKV_STORAGE_MOCKS.set(this.id, new MockMMKV(options));
        }
        
        this.mock = global.__MMKV_STORAGE_MOCKS.get(this.id);
      }

      set(key, value) {
        return this.mock.set(key, value);
      }
      
      getString(key) {
        return this.mock.getString(key);
      }
      
      delete(key) {
        return this.mock.delete(key);
      }
      
      getAllKeys() {
        return this.mock.getAllKeys();
      }
      
      clearAll() {
        return this.mock.clearAll();
      }
    }
  }
};

// Additional React Native mocks if needed
global.Headers = class Headers extends Map {
  constructor(init) {
    super();
    if (init) {
      Object.keys(init).forEach(key => {
        this.set(key, init[key]);
      });
    }
  }
  
  set(key, value) {
    return super.set(key.toLowerCase(), value);
  }
  
  get(key) {
    return super.get(key.toLowerCase());
  }
  
  has(key) {
    return super.has(key.toLowerCase());
  }
};

// Make sure the dist directory exists
if (!fs.existsSync(path.join(__dirname, 'dist'))) {
  console.error('Error: dist directory not found. Please build the project first:');
  console.error('  npm run build');
  process.exit(1);
}

// Import the Polycentric library
const Polycentric = require('./dist/polycentric-core.node.cjs');

// Run the tests
async function runTests() {
  console.log('===== Polycentric React Native Port Tests =====\n');
  
  try {
    // Test 1: Create a process handle
    console.log('Test 1: Creating process handle...');
    const processHandle = await Polycentric.createRNProcessHandle();
    console.log('✅ Successfully created process handle');
    console.log(`  System ID: ${Polycentric.Models.PublicKey.toString(processHandle.system())}\n`);
    
    // Test 2: Set username
    console.log('Test 2: Setting username...');
    await processHandle.setUsername('TestUser');
    console.log('✅ Username set successfully\n');
    
    // Test 3: Set description
    console.log('Test 3: Setting description...');
    await processHandle.setDescription('This is a test description');
    console.log('✅ Description set successfully\n');
    
    // Test 4: Posting content
    console.log('Test 4: Posting content...');
    const postContent = `Test post at ${new Date().toISOString()}`;
    const pointer = await processHandle.post(postContent);
    console.log('✅ Content posted successfully');
    console.log(`  Post ID: ${Polycentric.Models.Pointer.toString(pointer)}\n`);
    
    // Test 5: Add server
    console.log('Test 5: Adding server...');
    await processHandle.addServer('https://example-server.com');
    console.log('✅ Server added successfully\n');
    
    // Test 6: Query username
    console.log('Test 6: Querying username...');
    await new Promise((resolve) => {
      processHandle.queryManager.queryCRDT.query(
        processHandle.system(),
        Polycentric.Models.ContentType.ContentTypeUsername,
        (state) => {
          if (state.value) {
            const username = Polycentric.Util.decodeText(state.value);
            console.log(`✅ Username queried successfully: ${username}`);
            resolve();
          }
        }
      );
    });
    console.log('');
    
    // Test 7: Query latest posts
    console.log('Test 7: Querying latest posts...');
    await new Promise((resolve) => {
      processHandle.queryManager.queryLatest.query(
        processHandle.system(),
        [Polycentric.Models.ContentType.ContentTypePost],
        (state) => {
          console.log(`✅ Posts queried successfully: ${state.events.length} posts found`);
          if (state.events.length > 0) {
            for (const event of state.events) {
              const eventObj = Polycentric.Models.Event.fromBuffer(event.event);
              console.log(`  Post: ${Protocol.Post.decode(eventObj.content).content}`);
            }
          }
          resolve();
        }
      );
    });
    console.log('');
    
    console.log('All tests completed successfully! 🎉');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Global objects needed for the tests
global.fetch = async (url, options) => {
  console.log(`[FETCH] ${options?.method || 'GET'} ${url}`);
  
  // Mock response data
  const mockResponses = {
    '/events': Buffer.from([]),
    '/ranges': Buffer.from([]),
  };
  
  // Check if this is a known endpoint
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  
  if (mockResponses[pathname]) {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => mockResponses[pathname],
      text: async () => "OK",
    };
  }
  
  // Default fallback response
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from([]),
    text: async () => "OK",
  };
};

// Define Protocol object for test 7
const Protocol = {
  Post: {
    decode: (buffer) => {
      return { content: "Mock post content (binary data cannot be decoded in mock)" };
    }
  }
};

// Start the tests
runTests();