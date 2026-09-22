-- Security audit finding (2026-09-22, DL-SEC-31): the avatars bucket had no
-- server-side file size or MIME type limit, only client-side checks, which
-- are bypassable. Caps every upload at 5MB and restricts to real image types.

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'avatars';
