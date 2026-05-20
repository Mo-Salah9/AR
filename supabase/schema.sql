-- Run this in your Supabase SQL editor (https://app.supabase.com → SQL Editor)

CREATE TABLE IF NOT EXISTS public.rules (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword    TEXT        NOT NULL,
  url        TEXT        NOT NULL,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security (allow public read/write — no login required)
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON public.rules
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- Enable Realtime so the scanner picks up admin changes instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.rules;

-- Seed the default rule
INSERT INTO public.rules (keyword, url)
VALUES ('2025', 'https://www.google.com');
