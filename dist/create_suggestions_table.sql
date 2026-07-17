-- =========================================================================
-- SCRIPT PEMBUATAN TABEL: AI KNOWLEDGE SUGGESTIONS
-- Digunakan untuk menampung Draft Knowledge hasil pembelajaran AI Goro
-- Jalankan script ini di SQL Editor pada Dashboard Supabase Anda.
-- =========================================================================

-- Hapus tabel lama jika ada agar bisa mengulang pengaturan RLS dari awal
DROP TABLE IF EXISTS public.ai_knowledge_suggestions CASCADE;

CREATE TABLE IF NOT EXISTS public.ai_knowledge_suggestions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    question TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    intent TEXT,
    opd TEXT,
    suggested_title TEXT,
    summary TEXT,
    ai_answer TEXT,
    category TEXT,
    suggested_tags TEXT[],
    keywords TEXT[],
    suggested_priority INTEGER DEFAULT 3,
    confidence NUMERIC(5,2),
    source TEXT,
    source_url TEXT,
    frequency_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_asked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing untuk pencarian duplikat yang cepat (menggunakan normalized_question)
CREATE INDEX IF NOT EXISTS idx_suggestions_normalized_question ON public.ai_knowledge_suggestions (normalized_question);

-- Trigger untuk update 'updated_at' secara otomatis ketika ada pembaruan data
CREATE OR REPLACE FUNCTION update_suggestions_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ai_knowledge_suggestions_modtime
BEFORE UPDATE ON public.ai_knowledge_suggestions
FOR EACH ROW
EXECUTE FUNCTION update_suggestions_updated_at_column();

-- Mematikan RLS secara eksplisit agar bot bebas melakukan Insert
ALTER TABLE public.ai_knowledge_suggestions DISABLE ROW LEVEL SECURITY;

-- =========================================================================
-- INSTRUKSI ADMIN:
-- 1. Copy seluruh script ini.
-- 2. Buka Supabase Dashboard > SQL Editor.
-- 3. Paste script ini dan klik "Run".
-- =========================================================================
