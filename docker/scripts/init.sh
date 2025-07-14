#!/bin/bash

echo "Initializing nopo... ${PWD}"

npm install --frozen-lockfile
npm run build
npm pack
mv nopo-*.tgz ./nopo.tgz
npm install ./nopo.tgz --global --no-fund
rm -f ./nopo.tgz

echo "nopo initialized."
echo "$ nopo <command>"
