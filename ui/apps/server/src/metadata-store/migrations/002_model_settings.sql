-- Per-chat model settings. Single JSON text column; NULL until the
-- user first picks a model / reasoning / context-window value.
ALTER TABLE Chat
  ADD COLUMN model_settings TEXT;
