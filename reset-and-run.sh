#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Cleaning old Next.js install..."
rm -rf node_modules .next package-lock.json
echo "Installing pinned dependencies..."
npm install
echo "Starting Lucid Core..."
npm run dev
