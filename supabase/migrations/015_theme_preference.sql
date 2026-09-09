-- Per-account theme preference. Defaults to 'light' (this app's default theme).
ALTER TABLE profiles ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'light'
  CHECK (theme_preference IN ('light', 'dark'));
