import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

type OcrRequestBody = {
  imageDataUrl?: string;
};

type PipelineStartBody = {
  source?: 'camera' | 'manual';
  imageDataUrl?: string;
  namecardData?: {
    name?: string;
    company?: string;
    title?: string;
    email?: string;
    phone?: string;
  };
};

type PipelineStepId = 'ocr' | 'person' | 'company' | 'merge' | 'score';

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
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function mockApiPlugin(): Plugin {
  return {
    name: 'local-mock-api',
    configureServer(server) {
      server.middlewares.use('/api/ocr/extract', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        try {
          const body = await readJsonBody<OcrRequestBody>(req);
          if (!body.imageDataUrl) {
            sendJson(res, 400, { error: 'imageDataUrl is required' });
            return;
          }

          sendJson(res, 200, {
            name: '岩辺達也',
            company: 'SanSan株式会社',
            title: 'SanSan事業部 SMB第3営業部',
            email: 'iwanabe@sansan.com',
            phone: '03-6419-3033'
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Mock OCR failed';
          sendJson(res, 500, { error: message });
        }
      });

      server.middlewares.use('/api/pipeline/start', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        try {
          const body = await readJsonBody<PipelineStartBody>(req);
          if (!body.source) {
            sendJson(res, 400, { error: 'source is required' });
            return;
          }

          sendJson(res, 200, {
            jobId: `mock-job-${randomUUID()}`
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Mock pipeline start failed';
          sendJson(res, 500, { error: message });
        }
      });

      server.middlewares.use('/api/pipeline/events', (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const jobId = url.searchParams.get('jobId');
        if (!jobId) {
          sendJson(res, 400, { error: 'jobId is required' });
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const stepIds: PipelineStepId[] = ['ocr', 'person', 'company', 'merge', 'score'];
        const timers: ReturnType<typeof setTimeout>[] = [];

        writeSse(res, { type: 'connected', jobId });

        stepIds.forEach((stepId, index) => {
          timers.push(setTimeout(() => {
            writeSse(res, {
              type: 'step_completed',
              step: stepId,
              status: 'completed'
            });

            if (index === stepIds.length - 1) {
              writeSse(res, { type: 'pipeline_done', status: 'completed' });
              res.end();
            }
          }, 1000 * (index + 1)));
        });

        req.on('close', () => {
          timers.forEach((timer) => clearTimeout(timer));
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), mockApiPlugin()]
});
