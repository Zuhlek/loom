// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachDeleteHandler } from '../src/client/delete.js';
import { render } from '../src/client/render.js';
import type { Bookmark } from '../src/types.js';

function bookmark(id: number): Bookmark {
  return {
    id,
    url: `https://${id}.example/`,
    title: `B${id}`,
    created_at: '2026-05-16T11:00:00.000Z',
  };
}

describe('attachDeleteHandler (T-008)', () => {
  let listRoot: HTMLElement;
  let formError: HTMLElement;
  let refresh: ReturnType<typeof vi.fn>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = '<section id="list"></section><output id="form-error"></output>';
    listRoot = document.getElementById('list') as HTMLElement;
    formError = document.getElementById('form-error') as HTMLElement;
    refresh = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function button(id: number): HTMLButtonElement {
    return listRoot.querySelector(`[data-action="delete"][data-id="${id}"]`) as HTMLButtonElement;
  }

  it('first click swaps the button to "Confirm delete?"', () => {
    render([bookmark(1)], listRoot);
    attachDeleteHandler(listRoot, refresh as () => Promise<void>);
    const btn = button(1);
    expect(btn.textContent).toBe('Delete');
    btn.click();
    expect(btn.textContent).toBe('Confirm delete?');
  });

  it('second click within 5s sends DELETE and calls refresh', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render([bookmark(1)], listRoot);
    attachDeleteHandler(listRoot, refresh as () => Promise<void>);
    const btn = button(1);
    btn.click();
    btn.click();
    // allow promise chain to settle
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/bookmarks/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('timeout after 5s reverts to "Delete" with no fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render([bookmark(1)], listRoot);
    attachDeleteHandler(listRoot, refresh as () => Promise<void>);
    const btn = button(1);
    btn.click();
    expect(btn.textContent).toBe('Confirm delete?');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(btn.textContent).toBe('Delete');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clicking a different row reverts the previous pending row', async () => {
    render([bookmark(1), bookmark(2)], listRoot);
    attachDeleteHandler(listRoot, refresh as () => Promise<void>);
    const b1 = button(1);
    const b2 = button(2);

    b1.click();
    expect(b1.textContent).toBe('Confirm delete?');
    b2.click();
    expect(b1.textContent).toBe('Delete');
    expect(b2.textContent).toBe('Confirm delete?');
  });

  it('on 404 from DELETE: shows error and still refreshes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'gone' } }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render([bookmark(1)], listRoot);
    attachDeleteHandler(listRoot, refresh as () => Promise<void>);
    const btn = button(1);
    btn.click();
    btn.click();
    await vi.runAllTimersAsync();

    expect(formError.textContent).toMatch(/gone|not.?found/i);
    expect(refresh).toHaveBeenCalled();
  });
});
