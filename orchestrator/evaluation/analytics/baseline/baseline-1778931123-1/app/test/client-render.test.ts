// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from '../src/client/render.js';
import { listBookmarks, createBookmark, deleteBookmark } from '../src/client/api.js';
import type { Bookmark } from '../src/types.js';

function makeBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 1,
    url: 'https://a.example/',
    title: 'A',
    created_at: '2026-05-16T11:00:00.000Z',
    ...over,
  };
}

describe('render (T-006)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('section');
  });

  it('emits empty-state message and no <ul> when list is empty', () => {
    render([], root);
    expect(root.querySelector('ul')).toBeNull();
    const empty = root.querySelector('.empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? '').toMatch(/no bookmarks/i);
  });

  it('renders one <li> per bookmark with title text and URL text', () => {
    render([makeBookmark({ id: 1, url: 'https://a/', title: 'A' })], root);
    const items = root.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('A');
    expect(items[0].textContent).toContain('https://a/');
  });

  it('every anchor has target="_blank" and rel="noopener"', () => {
    render([makeBookmark({ id: 1, url: 'https://a/', title: 'A' })], root);
    const a = root.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://a/');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener');
  });

  it('preserves input order (caller controls sort)', () => {
    const b1 = makeBookmark({ id: 1, url: 'https://a/', title: 'A' });
    const b2 = makeBookmark({ id: 2, url: 'https://b/', title: 'B' });
    render([b2, b1], root);
    const items = root.querySelectorAll('li');
    expect(items[0].textContent).toContain('B');
    expect(items[1].textContent).toContain('A');
  });

  it('escapes potentially hostile titles/urls (no <script> emitted)', () => {
    const b = makeBookmark({
      id: 1,
      url: 'https://evil.example/?<script>alert(1)</script>',
      title: '<script>alert("xss")</script>',
    });
    render([b], root);
    // No literal <script> elements should be created from rendering data.
    expect(root.querySelectorAll('script').length).toBe(0);
  });

  it('emits a delete affordance with data-id and data-action="delete"', () => {
    render([makeBookmark({ id: 42 })], root);
    const btn = root.querySelector('[data-action="delete"]') as HTMLElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('data-id')).toBe('42');
  });

  it('replaces previous content on re-render', () => {
    render([makeBookmark({ id: 1 })], root);
    render([], root);
    expect(root.querySelectorAll('li').length).toBe(0);
    expect(root.querySelector('.empty')).not.toBeNull();
  });
});

describe('api.ts (T-006)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('listBookmarks GETs /api/bookmarks and returns json', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, url: 'https://a/', title: 'A', created_at: 'x' }],
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await listBookmarks();
    expect(fetchSpy).toHaveBeenCalledWith('/api/bookmarks', expect.anything());
    expect(res).toEqual([{ id: 1, url: 'https://a/', title: 'A', created_at: 'x' }]);
  });

  it('listBookmarks throws ApiError-shaped object on non-2xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'internal', message: 'boom' } }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(listBookmarks()).rejects.toMatchObject({ code: 'internal', message: 'boom' });
  });

  it('createBookmark POSTs JSON and returns parsed body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, url: 'https://a/', title: 'A', created_at: 'x' }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await createBookmark({ url: 'https://a/', title: 'A' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/bookmarks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ url: 'https://a/', title: 'A' }),
      }),
    );
    expect(res.id).toBe(1);
  });

  it('createBookmark throws on 409 with code+message+field', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'duplicate_url', message: 'dup', field: 'url' },
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(createBookmark({ url: 'x', title: 'y' })).rejects.toMatchObject({
      code: 'duplicate_url',
      message: 'dup',
      field: 'url',
    });
  });

  it('deleteBookmark sends DELETE and resolves on 204', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await deleteBookmark(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/bookmarks/7',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteBookmark throws on 404', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'gone' } }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(deleteBookmark(7)).rejects.toMatchObject({ code: 'not_found' });
  });
});
