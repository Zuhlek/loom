import { createBookmark, type ApiError } from './api.js';

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function clearFieldErrors(): void {
  setText('url-error', '');
  setText('title-error', '');
  setText('form-error', '');
}

export function attachSaveForm(formEl: HTMLFormElement, refresh: () => Promise<void>): void {
  formEl.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFieldErrors();

    const urlInput = document.getElementById('url') as HTMLInputElement | null;
    const titleInput = document.getElementById('title') as HTMLInputElement | null;
    const url = urlInput?.value ?? '';
    const title = titleInput?.value ?? '';

    try {
      await createBookmark({ url, title });
      if (urlInput) urlInput.value = '';
      if (titleInput) titleInput.value = '';
      await refresh();
    } catch (err) {
      const e = err as ApiError;
      const message = e?.message ?? 'Save failed.';
      if (e?.field === 'url') {
        setText('url-error', message);
      } else if (e?.field === 'title') {
        setText('title-error', message);
      } else {
        setText('form-error', message);
      }
    }
  });
}
