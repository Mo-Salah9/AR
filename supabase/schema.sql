-- Run this in your Supabase SQL editor (https://app.supabase.com → SQL Editor)

CREATE TABLE IF NOT EXISTS public.rules (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword    TEXT        NOT NULL,   -- used for text OCR detection and as display label
  url        TEXT,                   -- optional URL to open
  image_url  TEXT,                   -- optional reference image for image-marker detection
  model_url  TEXT,                   -- optional .glb/.gltf 3D model to show in viewer
  video_url  TEXT,                   -- optional video to play when detected
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security (allow public read/write — no login required)
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all" ON public.rules;
CREATE POLICY "public_all" ON public.rules
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- Enable Realtime so the scanner picks up admin changes instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.rules;

-- ── Storage buckets ─────────────────────────────────────────────
-- Create two public buckets: one for marker images, one for 3D models

INSERT INTO storage.buckets (id, name, public)
VALUES ('markers', 'markers', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('models', 'models', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read/write on both buckets (drop first to avoid duplicate errors)
DROP POLICY IF EXISTS "markers_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "markers_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "markers_public_update" ON storage.objects;
DROP POLICY IF EXISTS "markers_public_delete" ON storage.objects;
DROP POLICY IF EXISTS "models_public_read"    ON storage.objects;
DROP POLICY IF EXISTS "models_public_insert"  ON storage.objects;
DROP POLICY IF EXISTS "models_public_update"  ON storage.objects;
DROP POLICY IF EXISTS "models_public_delete"  ON storage.objects;

CREATE POLICY "markers_public_read"   ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'markers');
CREATE POLICY "markers_public_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'markers');
CREATE POLICY "markers_public_update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'markers');
CREATE POLICY "markers_public_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'markers');

CREATE POLICY "models_public_read"    ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'models');
CREATE POLICY "models_public_insert"  ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'models');
CREATE POLICY "models_public_update"  ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'models');
CREATE POLICY "models_public_delete"  ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'models');

DROP POLICY IF EXISTS "videos_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "videos_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "videos_public_update" ON storage.objects;
DROP POLICY IF EXISTS "videos_public_delete" ON storage.objects;

CREATE POLICY "videos_public_read"    ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'videos');
CREATE POLICY "videos_public_insert"  ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'videos');
CREATE POLICY "videos_public_update"  ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'videos');
CREATE POLICY "videos_public_delete"  ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'videos');

-- ── Migration (run only if the table already exists) ─────────────
-- ALTER TABLE public.rules ALTER COLUMN url DROP NOT NULL;
-- ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS image_url TEXT;
-- ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS model_url  TEXT;
-- ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS video_url  TEXT;

-- Seed the default rule
INSERT INTO public.rules (keyword, url)
VALUES ('2025', 'https://www.google.com')
ON CONFLICT DO NOTHING;
