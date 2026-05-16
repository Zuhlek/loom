import { listBookmarks } from './api.js';
import { render } from './render.js';
import { attachSaveForm } from './form.js';
import { attachDeleteHandler } from './delete.js';

function showFetchError(message: string): void {
  const slot = document.getElementById('form-error');
  if (slot) slot.textContent = message;
}

export async function refresh(): Promise<void> {
  const root = document.getElementById('list');
  if (!root) return;
  try {
    const list = await listBookmarks();
    render(list, root);
  } catch (err) {
    const e = err as { message?: string };
    showFetchError(e?.message ?? 'Failed to load bookmarks.');
  }
}

export function bootstrap(): void {
  const form = document.getElementById('save-form') as HTMLFormElement | null;
  const list = document.getElementById('list');
  if (form) attachSaveForm(form, refresh);
  if (list) attachDeleteHandler(list, refresh);
  void refresh();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
  });
}
