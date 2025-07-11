#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const CONFIG = {
  // Test parameters
  messageCounts: [10, 20, 50, 100, 200, 500, 1000],
  timeoutMs: 3000,
  batchSize: 10,
  maxBatches: 10,
  
  // Server URLs
  prodServer: 'https://srv1-prod.polycentric.io',
  testServer: 'https://grayjay-srv1-test.polycentric.io',
  
  // Delays (in ms)
  serverProcessingDelay: 5000,
  betweenTestsDelay: 3000,
  betweenBatchesDelay: 100,
};

function printUsage() {
  console.log(`
🚀 Grayjay Backfill Test Runner

Usage:
  npm run grayjay-test [options]

Options:
  --help, -h          Show this help message
  --quick             Run with smaller message counts (10, 20, 50, 100)
  --slow              Run with larger message counts (100, 200, 500, 1000, 2000)
  --timeout <ms>      Set timeout in milliseconds (default: 3000)
  --batch-size <n>    Set batch size (default: 10)
  --max-batches <n>   Set maximum batches (default: 10)

Examples:
  npm run grayjay-test                    # Run default test
  npm run grayjay-test --quick            # Quick test with fewer messages
  npm run grayjay-test --timeout 5000     # Test with 5-second timeout
  npm run grayjay-test --batch-size 5     # Test with smaller batches

Environment Variables:
  PROD_SERVER          Production server URL
  TEST_SERVER          Test server URL
  TIMEOUT_MS           Timeout in milliseconds
  BATCH_SIZE           Batch size
  MAX_BATCHES          Maximum batches

The test will:
1. Create test accounts with varying message counts
2. Post messages to production server
3. Test backfill performance on test server
4. Report timing and timeout issues
`);
}

function parseArgs(): { 
  quick: boolean; 
  slow: boolean; 
  timeout?: number; 
  batchSize?: number; 
  maxBatches?: number;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const options: any = { quick: false, slow: false, help: false };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--quick':
        options.quick = true;
        break;
      case '--slow':
        options.slow = true;
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i]);
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i]);
        break;
      case '--max-batches':
        options.maxBatches = parseInt(args[++i]);
        break;
    }
  }
  
  return options;
}

function updateConfig(options: any) {
  if (options.quick) {
    CONFIG.messageCounts = [10, 20, 50, 100];
  } else if (options.slow) {
    CONFIG.messageCounts = [100, 200, 500, 1000, 2000];
  }
  
  if (options.timeout) {
    CONFIG.timeoutMs = options.timeout;
  }
  
  if (options.batchSize) {
    CONFIG.batchSize = options.batchSize;
  }
  
  if (options.maxBatches) {
    CONFIG.maxBatches = options.maxBatches;
  }
  
  // Override with environment variables
  if (process.env.PROD_SERVER) {
    CONFIG.prodServer = process.env.PROD_SERVER;
  }
  
  if (process.env.TEST_SERVER) {
    CONFIG.testServer = process.env.TEST_SERVER;
  }
  
  if (process.env.TIMEOUT_MS) {
    CONFIG.timeoutMs = parseInt(process.env.TIMEOUT_MS);
  }
  
  if (process.env.BATCH_SIZE) {
    CONFIG.batchSize = parseInt(process.env.BATCH_SIZE);
  }
  
  if (process.env.MAX_BATCHES) {
    CONFIG.maxBatches = parseInt(process.env.MAX_BATCHES);
  }
}

function generateConfigFile() {
  const configContent = `// Auto-generated config for backfill test
export const CONFIG = ${JSON.stringify(CONFIG, null, 2)};
`;

  const configPath = join(__dirname, 'test-config.ts');
  
  try {
    require('fs').writeFileSync(configPath, configContent);
    console.log(`✅ Generated config file: ${configPath}`);
  } catch (error) {
    console.error(`❌ Failed to generate config file: ${error}`);
  }
}

function checkDependencies() {
  const packageJsonPath = join(__dirname, '..', 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    console.error('❌ package.json not found. Are you in the correct directory?');
    process.exit(1);
  }
  
  try {
    const packageJson = require(packageJsonPath);
    if (!packageJson.dependencies['@polycentric/polycentric-core']) {
      console.error('❌ @polycentric/polycentric-core dependency not found. Run npm install first.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to read package.json:', error);
    process.exit(1);
  }
}

function buildProject() {
  console.log('🔨 Building project...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ Build completed');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

function runTest() {
  console.log('🧪 Running Grayjay backfill test...');
  console.log(`📊 Configuration:`);
  console.log(`   Message counts: ${CONFIG.messageCounts.join(', ')}`);
  console.log(`   Timeout: ${CONFIG.timeoutMs}ms`);
  console.log(`   Batch size: ${CONFIG.batchSize}`);
  console.log(`   Max batches: ${CONFIG.maxBatches}`);
  console.log(`   Prod server: ${CONFIG.prodServer}`);
  console.log(`   Test server: ${CONFIG.testServer}`);
  console.log('');
  
  try {
    execSync('node dist/grayjay-backfill-test.js', { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    printUsage();
    return;
  }
  
  console.log('🚀 Grayjay Backfill Test Runner');
  console.log('================================');
  
  // Check dependencies
  checkDependencies();
  
  // Update configuration
  updateConfig(options);
  
  // Generate config file
  generateConfigFile();
  
  // Build project
  buildProject();
  
  // Run test
  runTest();
  
  console.log('\n✅ Test completed!');
}

main().catch(console.error); 