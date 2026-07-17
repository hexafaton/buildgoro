-- =========================================================================
-- PUBLIC DEMAND ANALYTICS ENGINE TABLES
-- Untuk Goro AI Enterprise Public Service Intelligence System
-- =========================================================================

-- 1. TABEL TOPIK (Akumulasi & Metrik Analitik)
DROP TABLE IF EXISTS public.public_demand_logs CASCADE;
DROP TABLE IF EXISTS public.public_demand_topics CASCADE;

CREATE TABLE IF NOT EXISTS public.public_demand_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT UNIQUE NOT NULL,
    category TEXT,
    opd TEXT,
    intent TEXT,
    priority TEXT DEFAULT 'Medium',
    
    -- Hitungan Cache (di-update oleh backend)
    count_today INTEGER DEFAULT 0,
    count_week INTEGER DEFAULT 0,
    count_month INTEGER DEFAULT 0,
    count_total INTEGER DEFAULT 0,
    
    -- Status & Analisis
    knowledge_exists BOOLEAN DEFAULT false,
    trend_status TEXT DEFAULT 'Stabil',
    early_warning_status TEXT DEFAULT 'Aman',
    knowledge_effectiveness TEXT DEFAULT 'Belum Dievaluasi',
    ai_recommendation TEXT,
    
    last_asked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing untuk pencarian dan filter cepat
CREATE INDEX IF NOT EXISTS idx_demand_topics_opd ON public.public_demand_topics(opd);
CREATE INDEX IF NOT EXISTS idx_demand_topics_category ON public.public_demand_topics(category);
CREATE INDEX IF NOT EXISTS idx_demand_topics_knowledge ON public.public_demand_topics(knowledge_exists);

-- Trigger Update Time
CREATE OR REPLACE FUNCTION update_demand_topics_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_public_demand_topics_modtime
BEFORE UPDATE ON public.public_demand_topics
FOR EACH ROW
EXECUTE FUNCTION update_demand_topics_updated_at_column();


-- 2. TABEL LOGS (Riwayat Pertanyaan Individual)
CREATE TABLE IF NOT EXISTS public.public_demand_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES public.public_demand_topics(id) ON DELETE CASCADE,
    user_question TEXT NOT NULL,
    knowledge_was_found BOOLEAN DEFAULT false,
    asked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_logs_topic_id ON public.public_demand_logs(topic_id);
CREATE INDEX IF NOT EXISTS idx_demand_logs_asked_at ON public.public_demand_logs(asked_at);

-- Mematikan RLS secara eksplisit
ALTER TABLE public.public_demand_topics DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demand_logs DISABLE ROW LEVEL SECURITY;

-- =========================================================================
-- INSTRUKSI ADMIN:
-- 1. Copy seluruh script ini.
-- 2. Buka Supabase Dashboard > SQL Editor.
-- 3. Paste script ini dan klik "Run" untuk mengaktifkan Public Demand Analytics.
-- =========================================================================
