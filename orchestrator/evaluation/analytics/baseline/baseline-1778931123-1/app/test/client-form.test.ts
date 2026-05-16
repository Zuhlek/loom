// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachSaveForm } from '../src/client/form.js';

function buildFormDom(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="save-form" novalidate>
      <label>URL
        <input id="url" name="url" type="text" />
        <output id="url-error" class="field-error"></output>
      </label>
      <label>Title
        <input id="title" name="title" type="text" />
        <output id="title-error" class="field-error"></output>
      </label>
      <button type="submit">Save</button>
      <output id="form-error" class="form-error"></output>
    </form>
  `;
  return document.getElementById('save-form') as HTMLFormElement;
}

function setValue(id: string, value: string): void {
  (document.getElementById(id) as HTMLInputElement).value = value;
}

function submitForm(form: HTMLFormElement): Promise<void> {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  // microtask flush
  return new Promise((r) => setTimeout(r, 0));
}

describe('attachSaveForm (T-007)', () => {
  let form: HTMLFormElement;
  let refresh: ReturnType<typeof vi.fn>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    form = buildFormDom();
    refresh = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('on success: POSTs JSON, clears inputs, awaits refresh', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, url: 'https://a/', title: 'A', created_at: 'x' }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    attachSaveForm(form, refresh as () => Promise<void>);
    setValue('url', 'https://a/');
    setValue('title', 'A');
    await submitForm(form);
    // flush any extra microtasks
    await new Promise((r) => setTimeout(r, 5));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/bookmarks',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(refresh).toHaveBeenCalled();
    expect((document.getElementById('url') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('title') as HTMLInputElement).value).toBe('');
  });

  it('on 409 duplicate_url: renders message under url-error slot', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'duplicate_url', message: 'URL already exists: https://a/', field: 'url' },
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    attachSaveForm(form, refresh as () => Promise<void>);
    setValue('url', 'https://a/');
    setValue('title', 'A');
    await submitForm(form);
    await new Promise((r) => setTimeout(r, 5));

    expect(document.getElementById('url-error')?.textContent).toContain('URL already exists');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('on 400 validation field=url: renders under url-error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'validation', message: 'url must use http or https', field: 'url' },
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    attachSaveForm(form, refresh as () => Promise<void>);
    setValue('url', 'ftp://x/');
    setValue('title', 'X');
    await submitForm(form);
    await new Promise((r) => setTimeout(r, 5));

    expect(document.getElementById('url-error')?.textContent).toMatch(/http or https/);
  });

  it('on 400 validation field=title: renders under title-error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'validation', message: 'title must not be empty', field: 'title' },
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    attachSaveForm(form, refresh as () => Promise<void>);
    setValue('url', 'https://a/');
    setValue('title', '   ');
    await submitForm(form);
    await new Promise((r) => setTimeout(r, 5));

    expect(document.getElementById('title-error')?.textContent).toMatch(/empty/);
  });

  it('field errors clear on the next successful submit', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: 'validation', message: 'url bad', field: 'url' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 1, url: 'https://a/', title: 'A', created_at: 'x' }),
      });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    attachSaveForm(form, refresh as () => Promise<void>);

    setValue('url', 'bad');
    setValue('title', 'X');
    await submitForm(form);
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById('url-error')?.textContent).toBe('url bad');

    setValue('url', 'https://a/');
    setValue('title', 'X');
    await submitForm(form);
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById('url-error')?.textContent).toBe('');
  });
});
