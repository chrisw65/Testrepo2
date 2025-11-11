import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const app = express();
const { unlink } = fsPromises;

const UPLOAD_LIMIT_MB = Number(process.env.UPLOAD_LIMIT_MB ?? 25);
const DOCUMENT_TTL_MINUTES = Number(process.env.DOCUMENT_TTL_MINUTES ?? 30);

const uploadLimitMb = Number.isFinite(UPLOAD_LIMIT_MB) && UPLOAD_LIMIT_MB > 0 ? UPLOAD_LIMIT_MB : 25;
const documentTtlMinutes =
  Number.isFinite(DOCUMENT_TTL_MINUTES) && DOCUMENT_TTL_MINUTES > 0 ? DOCUMENT_TTL_MINUTES : 30;

const uploadLimitBytes = uploadLimitMb * 1024 * 1024;
const documentTtlMs = documentTtlMinutes * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.resolve(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const documents = new Map();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const id = randomUUID();
      const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
      const filename = `${id}${ext}`;
      req.generatedDocumentId = id;
      cb(null, filename);
    }
  }),
  limits: { fileSize: uploadLimitBytes },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are supported.'));
      return;
    }
    cb(null, true);
  }
});

function registerDocument(id, file) {
  const expiresAt = new Date(Date.now() + documentTtlMs);
  const timeout = setTimeout(() => {
    documents.delete(id);
    unlink(file.path).catch((error) => {
      if (error?.code !== 'ENOENT') {
        console.error(`Failed to remove expired document ${id}`, error);
      }
    });
  }, documentTtlMs);

  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  documents.set(id, {
    path: file.path,
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
    expiresAt,
    timeout
  });

  return expiresAt;
}

async function removeDocument(id) {
  const entry = documents.get(id);
  if (!entry) {
    return false;
  }

  clearTimeout(entry.timeout);
  documents.delete(id);

  try {
    await unlink(entry.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`Failed to delete document ${id}`, error);
      throw error;
    }
  }

  return true;
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (req.file.mimetype !== 'application/pdf') {
    unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Only PDF files are supported.' });
  }

  const id = req.generatedDocumentId ?? randomUUID();
  const expiresAt = registerDocument(id, req.file);

  res.status(201).json({
    id,
    name: req.file.originalname,
    size: req.file.size,
    expiresAt: expiresAt.toISOString()
  });
});

const clientDist = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  console.warn('Client build directory not found. Serving API only.');
}

app.get('/api/documents/:id', (req, res) => {
  const entry = documents.get(req.params.id);

  if (!entry) {
    return res.status(404).json({ error: 'Document not found or has expired.' });
  }

  res.sendFile(entry.path, {
    headers: {
      'Content-Type': entry.mimeType,
      'Content-Length': entry.size,
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${encodeURIComponent(entry.originalName)}"`
    }
  }, (error) => {
    if (!error) {
      return;
    }

    if (error.code === 'ENOENT') {
      documents.delete(req.params.id);
      if (!res.headersSent) {
        res.status(404).json({ error: 'Document not found or has expired.' });
      }
      return;
    }

    console.error(`Failed to stream document ${req.params.id}`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to retrieve document.' });
    }
  });
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const removed = await removeDocument(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Document not found or already removed.' });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Unable to delete document.' });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `PDFs up to ${uploadLimitMb}MB are accepted.` });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err?.message === 'Only PDF files are supported.') {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Flipbook server listening on port ${PORT}`);
});
