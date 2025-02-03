#!/bin/bash
set -euo pipefail

npx prettier@3.1.1  $1  -c || (npx prettier@3.1.1  . -w --loglevel silent && git --no-pager diff --color $1 ; git reset --hard &> /dev/null && echo "The above diffs were found by prettier. Please run prettier locally and commit the changes." && false)
