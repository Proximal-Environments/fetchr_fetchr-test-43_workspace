#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

// Retrieve the input file path from command-line arguments
const inputFilePath = process.argv[2];
if (!inputFilePath) {
  console.error('Usage: npx ts-node transform-converters.ts <path_to_original_converters.ts>');
  process.exit(1);
}

// Read the original file content
let content = fs.readFileSync(inputFilePath, 'utf8');

// Match all import lines
const importRegex = /import\s+{[^}]+}\s+from\s+['"]([^'"]+)['"];\n?/g;
let match: RegExpExecArray | null;
const importsToRemove: string[] = [];

while ((match = importRegex.exec(content)) !== null) {
  const fullImportLine = match[0]; // The full import line
  const importSource = match[1]; // The source module path after 'from'

  // If the import is from "@prisma/client", mark it for removal
  if (importSource.includes('@prisma/client')) {
    importsToRemove.push(fullImportLine);
  }
}

// Remove only the marked imports (those from @prisma/client)
for (const imp of importsToRemove) {
  content = content.replace(imp, '');
}

// Replace parameter types (db types and style_swipe) with string
content = content.replace(/(:\s*)(db[A-Z][A-Za-z0-9_]*|style_swipe)\b/g, '$1string');

// Remove return types from function declarations
content = content.replace(/(function\s+\w+\([^)]*\)):\s*[A-Za-z0-9_]+(\s*)(?=\{)/g, '$1');

// Add a header comment to indicate the file is generated
const headerComment = `// This file is generated from: ${inputFilePath}\n\n`;
content = headerComment + content;

// Define all output paths
const outputPaths = ['../../app/src/shared/', '../../admin_dashboard/src/shared/'];

// Files to copy
const filesToCopy = [
  { source: inputFilePath, destination: 'converters.ts', transform: true },
  { source: './src/shared/notifications.ts', destination: 'notifications.ts', transform: false },
  { source: './src/shared/appStoreReview.ts', destination: 'appStoreReview.ts', transform: false },
];

// Ensure all output directories exist and copy files to each location
for (const outputBasePath of outputPaths) {
  fs.mkdirSync(outputBasePath, { recursive: true });

  for (const file of filesToCopy) {
    let fileContent;

    if (file.transform) {
      // Use the existing transformation logic for converters.ts
      fileContent = content;
    } else {
      // Direct copy for notifications.ts
      fileContent = fs.readFileSync(file.source, 'utf8');
    }

    const outputPath = path.join(outputBasePath, file.destination);
    fs.writeFileSync(outputPath, fileContent, 'utf8');
    console.log(`File written to ${outputPath}`);
  }
}
