import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/bundle.js',
  external: [
    '@priompt',
    '@grpc/grpc-js',
    '@opentelemetry/otlp-exporter-base',
    'mock-aws-s3',
    'aws-sdk',
    'nock',
    'fsevents',
    'encoding',
    '@middleware.io/node-apm',
    '@opentelemetry/otlp-exporter-base',
    'onnxruntime-node',
    '@prisma/client',
  ].filter(Boolean),
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Preload ONNX Runtime bindings
try {
  require("onnxruntime-node");
} catch (e) {
  console.error("Failed to load ONNX Runtime:", e);
}
`,
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: { '.node': 'file' },
});

// Copy schema to dist
fs.copyFileSync(
  path.resolve(__dirname, './schema.prisma'),
  path.resolve(__dirname, 'dist/schema.prisma'),
);
