#!/usr/bin/env node
import { access, mkdir, rename, rm } from 'node:fs/promises';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tar from 'tar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const destinationDir = path.join(projectRoot, 'public', 'cmaps');
const tempDir = path.join(projectRoot, 'public', '.cmaps-tmp');

function formatError(error) {
  if (error instanceof AggregateError) {
    const codes = Array.from(
      new Set(
        (error.errors || [])
          .map((entry) => (entry && typeof entry === 'object' && 'code' in entry ? entry.code : undefined))
          .filter(Boolean)
      )
    );
    const baseMessage = error.message || 'Unexpected error while downloading pdf.js CMaps.';
    if (codes.length === 0) {
      return baseMessage;
    }

    return `${baseMessage} (codes: ${codes.join(', ')})`;
  }

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const message = error instanceof Error && error.message ? error.message : 'Unexpected error while downloading pdf.js CMaps.';
    return `${message} (code: ${error.code})`;
  }

  if (error instanceof Error) {
    return error.message || 'Unexpected error while downloading pdf.js CMaps.';
  }

  return String(error);
}

async function resolvePdfjsVersion() {
  const pkg = await import('pdfjs-dist/package.json', { with: { type: 'json' } });
  return pkg.default.version;
}

function downloadStream(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading pdf.js CMaps.'));
      return;
    }

    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, url).toString();
          response.resume();
          downloadStream(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to download pdf.js CMaps from ${url} (status ${response.statusCode}).`));
          return;
        }

        resolve(response);
      })
      .on('error', reject);
  });
}

async function downloadAndExtract(version) {
  const tarballUrl = `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${version}.tgz`;
  const response = await downloadStream(tarballUrl);

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  await pipeline(
    response,
    tar.x({
      cwd: tempDir,
      strip: 1,
      filter: (entryPath) =>
        entryPath === 'package' ||
        entryPath === 'package/cmaps' ||
        entryPath.startsWith('package/cmaps/'),
    })
  );
}

async function moveIntoPlace() {
  const extractedDir = path.join(tempDir, 'cmaps');
  try {
    await access(extractedDir);
  } catch (error) {
    throw new Error('CMaps directory was not found in the downloaded archive.');
  }

  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(path.dirname(destinationDir), { recursive: true });
  await rename(extractedDir, destinationDir);
  await rm(tempDir, { recursive: true, force: true });
}

try {
  const version = await resolvePdfjsVersion();
  await downloadAndExtract(version);
  await moveIntoPlace();
  console.log(`pdf.js CMaps downloaded for pdfjs-dist@${version} into client/public/cmaps`);
  console.log('Set VITE_PDF_CMAP_URL="/cmaps/" to enable them in the flipbook.');
} catch (error) {
  const formatted = formatError(error);
  console.error(formatted);
  if (formatted.includes('ENETUNREACH')) {
    console.error('Network unreachable. Ensure you have internet access or configure your proxy before running `npm run fetch-cmaps`.');
  }
  process.exitCode = 1;
}
