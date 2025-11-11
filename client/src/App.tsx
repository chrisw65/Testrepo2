import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker?url';
import { Flipbook } from './components/Flipbook';
import type { FlipbookPage, PageTexture } from './types';
import './App.css';

GlobalWorkerOptions.workerSrc = workerSrc;

const CMAP_URL = import.meta.env.VITE_PDF_CMAP_URL?.trim() || null;

async function renderPdfPages(pdfData: Uint8Array): Promise<FlipbookPage[]> {
  const params: DocumentInitParameters = {
    data: pdfData
  };

  if (CMAP_URL) {
    params.cMapUrl = CMAP_URL;
    params.cMapPacked = true;
  }

  const task = getDocument(params);
  const pdf = await task.promise;
  const rendered: FlipbookPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Unable to initialise drawing context');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;

    rendered.push({
      id: pageNumber,
      image: canvas.toDataURL('image/png'),
      width: viewport.width,
      height: viewport.height
    });
  }

  return rendered;
}

async function uploadThroughServer(file: File): Promise<{ id: string; expiresAt: string | null }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Unable to upload file');
  }

  const payload = await response.json();
  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Malformed server response');
  }

  return {
    id: payload.id,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null
  };
}

async function fetchServerDocument(id: string): Promise<Uint8Array> {
  const response = await fetch(`/api/documents/${id}`, {
    headers: {
      Accept: 'application/pdf'
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Unable to download document');
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function deleteServerDocument(id: string): Promise<void> {
  try {
    const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      const message = await response.text();
      throw new Error(message || 'Unable to release server document');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unexpected error releasing server document');
  }
}

export default function App() {
  const [pages, setPages] = useState<FlipbookPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [serverExpiry, setServerExpiry] = useState<string | null>(null);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [texture, setTexture] = useState<PageTexture>('smooth');

  const textureOptions = useMemo(
    () => [
      { value: 'smooth' satisfies PageTexture, label: 'Smooth matte' },
      { value: 'linen' satisfies PageTexture, label: 'Linen weave' },
      { value: 'recycled' satisfies PageTexture, label: 'Recycled fiber' },
      { value: 'canvas' satisfies PageTexture, label: 'Canvas grain' }
    ],
    []
  );

  const releaseServerDocument = useCallback(async (id: string | null) => {
    if (!id) {
      return;
    }

    try {
      await deleteServerDocument(id);
    } catch (deletionError) {
      console.warn('Failed to release server document', deletionError);
    }
  }, []);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setLoading(true);
    setError(null);

    let newDocumentId: string | null = null;
    let newServerExpiry: string | null = null;

    try {
      await releaseServerDocument(documentId);
      setDocumentId(null);
      setServerExpiry(null);

      let pdfBytes: Uint8Array;

      try {
        const metadata = await uploadThroughServer(file);
        newDocumentId = metadata.id;
        newServerExpiry = metadata.expiresAt;
        pdfBytes = await fetchServerDocument(metadata.id);
      } catch (serverError) {
        if (newDocumentId) {
          await releaseServerDocument(newDocumentId);
          newDocumentId = null;
          newServerExpiry = null;
        }
        console.warn('Falling back to local file processing', serverError);
        const buffer = await file.arrayBuffer();
        pdfBytes = new Uint8Array(buffer);
      }

      const renderedPages = await renderPdfPages(pdfBytes);
      setPages(renderedPages);
      setFileName(file.name);
      setDocumentId(newDocumentId);
      setServerExpiry(newServerExpiry);
    } catch (err) {
      if (newDocumentId) {
        await releaseServerDocument(newDocumentId);
        newDocumentId = null;
        newServerExpiry = null;
      }
      setPages([]);
      setDocumentId(null);
      setServerExpiry(null);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [documentId, releaseServerDocument]);

  const handleClear = useCallback(() => {
    void releaseServerDocument(documentId);
    setPages([]);
    setFileName('');
    setError(null);
    setDocumentId(null);
    setServerExpiry(null);
  }, [documentId, releaseServerDocument]);

  const handleTextureChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setTexture(event.target.value as PageTexture);
  }, []);

  const handleSoundToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSoundsEnabled(event.target.checked);
  }, []);

  useEffect(() => {
    return () => {
      void releaseServerDocument(documentId);
    };
  }, [documentId, releaseServerDocument]);

  const headerDescription = useMemo(() => {
    if (fileName) {
      return `Viewing: ${fileName}`;
    }
    return 'Upload any multi-page PDF to explore it with immersive page turning.';
  }, [fileName]);

  const serverExpiryDisplay = useMemo(() => {
    if (!serverExpiry) {
      return null;
    }

    const expiryDate = new Date(serverExpiry);
    if (Number.isNaN(expiryDate.getTime())) {
      return null;
    }

    return expiryDate.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }, [serverExpiry]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Flipbook Studio</h1>
        <p>{headerDescription}</p>

        {serverExpiryDisplay && pages.length > 0 && (
          <p className="app__notice" role="note">
            Server copy expires <strong>{serverExpiryDisplay}</strong>. Re-upload if you need more time.
          </p>
        )}

        <div className="app__actions">
          <label className="file-picker">
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={loading}
            />
            <span>{loading ? 'Processing…' : 'Select PDF'}</span>
          </label>
          <button type="button" onClick={handleClear} disabled={!pages.length && !fileName}>
            Clear
          </button>
        </div>

        <div className="app__settings">
          <label className="app__field">
            <span className="app__field-label">Page texture</span>
            <select value={texture} onChange={handleTextureChange}>
              {textureOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="app__field app__field--toggle">
            <input
              type="checkbox"
              checked={soundsEnabled}
              onChange={handleSoundToggle}
            />
            <span>Enable page turn sound</span>
          </label>
        </div>
      </header>

      {error && <div className="app__alert app__alert--error">{error}</div>}

      {!pages.length && !loading && !error && (
        <div className="app__empty">
          <div className="app__empty-illustration" aria-hidden="true">
            <div className="book">
              <div className="book__cover" />
              <div className="book__pages" />
            </div>
          </div>
          <p>Select a PDF to begin. Pages are rendered on the fly for a crisp flipbook experience.</p>
        </div>
      )}

      {loading && (
        <div className="app__alert app__alert--loading">
          <span className="spinner" aria-hidden="true" /> Rendering PDF pages…
        </div>
      )}

      {!!pages.length && !loading && (
        <Flipbook pages={pages} texture={texture} soundsEnabled={soundsEnabled} />
      )}

      <footer className="app__footer">
        <p>
          Page turning is simulated with physically-inspired easing, layered lighting, and true double-page
          spreads to mirror a tactile reading experience.
        </p>
      </footer>
    </div>
  );
}
