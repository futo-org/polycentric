#!/bin/bash

# Example script for running Grayjay backfill tests
# This script demonstrates different ways to run the tests

echo "🚀 Grayjay Backfill Test Examples"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the test-data-generator directory."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo ""
echo "📋 Available test commands:"
echo ""

echo "1. Quick test (fewer messages, faster):"
echo "   npm run grayjay-test -- --quick"
echo ""

echo "2. Slow test (more messages, longer):"
echo "   npm run grayjay-test -- --slow"
echo ""

echo "3. Custom timeout (5 seconds):"
echo "   npm run grayjay-test -- --timeout 5000"
echo ""

echo "4. Smaller batch size (5 events per batch):"
echo "   npm run grayjay-test -- --batch-size 5"
echo ""

echo "5. Environment variable configuration:"
echo "   TIMEOUT_MS=5000 BATCH_SIZE=5 npm run grayjay-test"
echo ""

echo "6. Using the runner script:"
echo "   npm run test:backfill -- --quick"
echo ""

echo "🔧 Configuration options:"
echo "   --help          Show help message"
echo "   --quick         Test with 10, 20, 50, 100 messages"
echo "   --slow          Test with 100, 200, 500, 1000, 2000 messages"
echo "   --timeout <ms>  Set timeout in milliseconds"
echo "   --batch-size <n> Set batch size"
echo "   --max-batches <n> Set maximum batches"
echo ""

echo "🌐 Environment variables:"
echo "   PROD_SERVER     Production server URL"
echo "   TEST_SERVER     Test server URL"
echo "   TIMEOUT_MS      Timeout in milliseconds"
echo "   BATCH_SIZE      Batch size"
echo "   MAX_BATCHES     Maximum batches"
echo ""

echo "💡 Recommended first run:"
echo "   npm run grayjay-test -- --quick"
echo ""

echo "Press Enter to run the quick test, or Ctrl+C to cancel..."
read

echo "🚀 Running quick test..."
npm run grayjay-test -- --quick 