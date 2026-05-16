import { deleteBookmark, type ApiError } from './api.js';

const CONFIRM_LABEL = 'Confirm delete?';
const IDLE_LABEL = 'Delete';
const CONFIRM_WINDOW_MS = 5_000;

interface Pending {
  id: number;
  btn: HTMLButtonElement;
  timeoutId: ReturnType<typeof setTimeout>;
}

function setFormError(message: string): void {
  const el = document.getElementById('form-error');
  if (el) el.textContent = message;
}

export function attachDeleteHandler(
  listRoot: HTMLElement,
  refresh: () => Promise<void>,
): void {
  let pending: Pending | null = null;
  let inFlight = false;

  const revert = (): void => {
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pending.btn.textContent = IDLE_LABEL;
    pending = null;
  };

  listRoot.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('[data-action="delete"]') ?? null;
    if (!btn) {
      revert();
      return;
    }
    const idAttr = btn.getAttribute('data-id');
    if (!idAttr) return;
    const id = Number(idAttr);

    if (pending && pending.btn === btn) {
      if (inFlight) return;
      inFlight = true;
      clearTimeout(pending.timeoutId);
      pending = null;
      void (async () => {
        try {
          await deleteBookmark(id);
        } catch (err) {
          const e = err as ApiError;
          setFormError(e?.message ?? 'Delete failed.');
        } finally {
          inFlight = false;
          try {
            await refresh();
          } catch {
            // ignore — refresh has its own error path
          }
        }
      })();
      return;
    }

    // Clicking a different row's button: revert the previous, start new.
    revert();
    btn.textContent = CONFIRM_LABEL;
    pending = {
      id,
      btn,
      timeoutId: setTimeout(() => {
        if (pending && pending.btn === btn) {
          btn.textContent = IDLE_LABEL;
          pending = null;
        }
      }, CONFIRM_WINDOW_MS),
    };
  });
}
