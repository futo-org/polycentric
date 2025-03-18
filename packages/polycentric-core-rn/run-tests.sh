#!/bin/bash
set -e

# Build the project
echo "Building Polycentric Core RN..."
npm run build

# Run the test runner
echo "Running tests..."
node test-runner.js