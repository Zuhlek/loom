import type { Bookmark, CreateBookmarkInput } from '../types.js';

export interface ApiError {
  code: string;
  message: string;
  field?: 'url' | 'title';
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body && typeof body === 'object' && body.error) {
      return body.error;
    }
  } catch {
    // body wasn't JSON
  }
  return { code: 'internal', message: `HTTP ${res.status}` };
}

async function jsonRequest<T>(input: RequestInfo, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return jsonRequest<Bookmark[]>('/api/bookmarks', { method: 'GET' });
}

export async function createBookmark(input: CreateBookmarkInput): Promise<Bookmark> {
  return jsonRequest<Bookmark>('/api/bookmarks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteBookmark(id: number): Promise<void> {
  await jsonRequest<void>(`/api/bookmarks/${id}`, { method: 'DELETE' });
}
