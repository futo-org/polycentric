#!/bin/bash
set -euo pipefail

npx prettier $1  -c || (npx prettier . -w --loglevel silent && git --no-pager diff --color $1 ; git reset --hard &> /dev/null && echo "The above diffs were found by prettier. Please run prettier locally and commit the changes." && false)
