import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const execFileAsync = promisify(execFile);

type OcrRequestBody = {
  imageDataUrl?: string;
};

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 25 * 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Unsupported image data URL');
  }

  const mime = match[1];
  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const ext = extMap[mime];
  if (!ext) {
    throw new Error(`Unsupported image mime type: ${mime}`);
  }

  return {
    buffer: Buffer.from(match[2], 'base64'),
    ext
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function ocrApiPlugin(): Plugin {
  return {
    name: 'local-ocr-api',
    configureServer(server) {
      server.middlewares.use('/api/ocr/extract', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        let tempPath = '';
        try {
          const body = await readJsonBody<OcrRequestBody>(req);
          if (!body.imageDataUrl) {
            sendJson(res, 400, { error: 'imageDataUrl is required' });
            return;
          }

          // Temporary mock response for frontend integration testing.
          sendJson(res, 200, {
            name: '岩辺達也',
            company: 'SanSan株式会社',
            title: 'SanSan事業部 SMB第３営業部',
            email: 'iwanabe@sansan.com',
            phone: '03-6419-3033'
          });
          return;

          const { buffer, ext } = parseDataUrl(body.imageDataUrl);
          tempPath = path.join(os.tmpdir(), `ocr-upload-${randomUUID()}${ext}`);
          await fs.writeFile(tempPath, buffer);

          const { stdout } = await execFileAsync('python3', ['meishi_ocr_kimi.py', tempPath], {
            cwd: process.cwd(),
            timeout: 60_000,
            maxBuffer: 2 * 1024 * 1024
          });

          const parsed = JSON.parse(stdout);
          sendJson(res, 200, parsed);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'OCR execution failed';
          sendJson(res, 500, { error: message });
        } finally {
          if (tempPath) {
            fs.unlink(tempPath).catch(() => undefined);
          }
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), ocrApiPlugin()]
});
