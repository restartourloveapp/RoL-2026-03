#!/usr/bin/env node
/**
 * Firebase Config Builder
 * Extracts Firebase config from a raw secret and creates firebase-applet-config.json
 */

const fs = require('fs');

const secretContent = process.env.RAW_SECRET;
if (!secretContent) {
  console.error('Error: RAW_SECRET environment variable not set');
  process.exit(1);
}

try {
  // Try to parse as JSON directly first
  let config;
  try {
    config = JSON.parse(secretContent);
  } catch (e) {
    // If that fails, try to extract from {...} block
    const match = secretContent.match(/\{([\s\S]*)\}/);
    if (!match) throw new Error('Could not find {...} block in secret');
    
    const body = match[1];
    config = {};
    
    // Extract key-value pairs using regex
    const regex = /([a-zA-Z0-9]+)\s*:\s*["']?([^"',\s}]+)["']?/g;
    let m;
    while ((m = regex.exec(body)) !== null) {
      config[m[1]] = m[2];
    }
  }

  if (!config.projectId) {
    throw new Error('projectId is missing from the configuration. Parsed keys: ' + Object.keys(config).join(', '));
  }

  fs.writeFileSync('firebase-applet-config.json', JSON.stringify(config, null, 2) + '\n');
  console.log('PROJECT_ID=' + config.projectId);
} catch (e) {
  console.error('Failed to parse Firebase configuration.');
  console.error(e.message);
  process.exit(1);
}
