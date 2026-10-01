-- Attachments, links and videos on email templates (e.g. a price list a lead asked for).
--
--   email_templates.attachments  JSONB [{ path, name, type, size }]   files attached to every email made from it
--   email_templates.links        JSONB [{ label, url }]               links (incl. videos) appended to the email body
--   email_logs.attachments       JSONB [{ path, name, type, size }]   what THIS draft/sent email carries
--
-- Files live in Storage, namespaced by organisation: <org_id>/<uuid>/<filename>.
--   email-attachments  PRIVATE. PDF / PNG / JPEG, 10 MB each. Only ever read by the
--                      send-email edge function (service role) and, for previews, by members
--                      of the owning org through a signed URL.
--   email-media        PUBLIC read. MP4 / MOV / WebM, 50 MB (Supabase's own per-file ceiling on the
--                      Free plan). Recipients open these from a link in the email, so they must be
--                      readable without logging in; the path contains a random UUID so it is unguessable.
-- Size and type limits are enforced here on the bucket itself, not just in the UI
-- (the avatars bucket had only client-side checks until the 2026-09-22 audit).

ALTER TABLE email_templates
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN links       JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE email_logs
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('email-attachments', 'email-attachments', false, 10485760, ARRAY['application/pdf', 'image/png', 'image/jpeg']),
  ('email-media',       'email-media',       true,  52428800, ARRAY['video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A user may add, read (private bucket previews) and remove files only inside a folder named
-- after an organisation they belong to.
CREATE POLICY "email_files_org_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('email-attachments', 'email-media')
    AND EXISTS (SELECT 1 FROM org_members m WHERE m.user_id = auth.uid() AND m.org_id::text = (storage.foldername(name))[1])
  );

CREATE POLICY "email_files_org_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('email-attachments', 'email-media')
    AND EXISTS (SELECT 1 FROM org_members m WHERE m.user_id = auth.uid() AND m.org_id::text = (storage.foldername(name))[1])
  );

CREATE POLICY "email_files_org_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('email-attachments', 'email-media')
    AND EXISTS (SELECT 1 FROM org_members m WHERE m.user_id = auth.uid() AND m.org_id::text = (storage.foldername(name))[1])
  );
