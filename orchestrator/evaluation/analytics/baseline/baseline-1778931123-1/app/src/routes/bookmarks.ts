import { Router, type Request, type Response } from 'express';
import { DuplicateUrlError, NotFoundError, type BookmarkRepo } from '../db.js';

type ErrorCode = 'validation' | 'duplicate_url' | 'not_found' | 'internal';
type ErrorField = 'url' | 'title';

function errorEnvelope(code: ErrorCode, message: string, field?: ErrorField) {
  return { error: field ? { code, message, field } : { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function bookmarksRouter(repo: BookmarkRepo): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.status(200).json(repo.list());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('GET /api/bookmarks failed', err);
      res.status(500).json(errorEnvelope('internal', 'database read failed'));
    }
  });

  router.post('/', (req: Request, res: Response) => {
    const body = req.body;
    if (!isPlainObject(body) || typeof body.url !== 'string' || typeof body.title !== 'string') {
      res
        .status(400)
        .json(errorEnvelope('validation', 'request body must be { url: string, title: string }'));
      return;
    }
    const rawUrl: string = body.url;
    const rawTitle: string = body.title;
    const title = rawTitle.trim();
    if (title.length === 0) {
      res
        .status(400)
        .json(errorEnvelope('validation', 'title must not be empty', 'title'));
      return;
    }
    if (rawUrl.length === 0) {
      res
        .status(400)
        .json(errorEnvelope('validation', 'url must not be empty', 'url'));
      return;
    }

    try {
      const created = repo.create({ url: rawUrl, title });
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof DuplicateUrlError) {
        res.status(409).json(errorEnvelope('duplicate_url', err.message, 'url'));
        return;
      }
      // canonicaliseUrl throws plain Error for parse/protocol failures
      if (err instanceof Error && err.message.startsWith('invalid URL')) {
        res
          .status(400)
          .json(errorEnvelope('validation', 'url is not a valid URL', 'url'));
        return;
      }
      if (err instanceof Error && err.message.startsWith('unsupported protocol')) {
        res
          .status(400)
          .json(errorEnvelope('validation', 'url must use http or https', 'url'));
        return;
      }
      // eslint-disable-next-line no-console
      console.error('POST /api/bookmarks failed', err);
      res.status(500).json(errorEnvelope('internal', 'unexpected error'));
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const raw = req.params.id;
    if (!/^[0-9]+$/.test(raw)) {
      res
        .status(400)
        .json(errorEnvelope('validation', 'id must be a positive integer'));
      return;
    }
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res
        .status(400)
        .json(errorEnvelope('validation', 'id must be a positive integer'));
      return;
    }
    try {
      repo.deleteById(id);
      res.status(204).end();
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json(errorEnvelope('not_found', err.message));
        return;
      }
      // eslint-disable-next-line no-console
      console.error('DELETE /api/bookmarks/:id failed', err);
      res.status(500).json(errorEnvelope('internal', 'unexpected error'));
    }
  });

  return router;
}
