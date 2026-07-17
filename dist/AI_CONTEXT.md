# Goro AI - Panduan Konteks AI & Arsitektur Sistem

Dokumen ini ditujukan agar agen AI eksternal (LLM) dapat dengan cepat memahami konteks implementasi, hubungan antarmodul secara detail, dan memberikan saran atau perubahan yang konsisten dengan desain sistem Goro AI.

Yang difokuskan pada dokumen ini bukanlah penjelasan teori, melainkan **struktur implementasi teknis**, **ringkasan file inti**, dan **pengelolaan knowledge base**.

## 1. Struktur Folder Lengkap Proyek
Berikut adalah struktur pohon (tree) direktori utama proyek Goro AI (hingga kedalaman 3 tingkat):

```text
chatbotgoro/
├── agent/
│   ├── core/
│   │   ├── agent.js                 # Handler utama pesan masuk WhatsApp
│   │   ├── ai_router.js             # LLM Intent recognition & routing
│   │   ├── conversation_memory.js   # Pengelola state & riwayat memori (Short-term)
│   │   └── executor.js              # Pengeksekusi tools (Web search, RAG)
│   ├── prompts/                     # (Opsional) Kumpulan template prompt LLM
│   ├── tools/                       # Integrasi custom tool function
│   └── workflows/
│       └── task_flow.js             # Orkestrator langkah-langkah respons AI
├── api/
│   └── server.js                    # Web server, inisialisasi WA, Watchdog
├── config/
│   ├── env.js                       # Loader untuk environment variables
│   ├── escalation_rules.js          # Aturan Human Handoff (serahkan ke admin)
│   ├── guardrails.js                # Filter kata kasar / out-of-scope topik
│   └── opd_registry.js              # Database statis Organisasi Perangkat Daerah
├── llm/
│   ├── embeddings/                  # Penghasil vektor embedding (RAG)
│   └── providers/                   # Klien abstraksi untuk OpenAI API / LLM lainnya
├── memory/
│   ├── long_term/                   # Penyimpanan jangka panjang percakapan
│   └── vector_store/                # Database vektor untuk Knowledge Base
├── ecosystem.config.js              # Konfigurasi PM2 untuk VPS deployment
├── index.js                         # Entry point aplikasi (memanggil api/server.js)
└── package.json                     # Daftar dependensi utama proyek
```

## 2. Ringkasan File Inti & Hubungan Antarmodul

Berikut adalah detail bagaimana file-file inti saling berinteraksi:

- **`api/server.js`**
  Ini adalah cangkang (shell) infrastruktur. Bertanggung jawab menghubungkan aplikasi ke WhatsApp via `whatsapp-web.js` (Puppeteer). Di sini terdapat logika perlindungan *resilience* tinggi seperti **Watchdog**, *Clean up Lock Files*, dan *Auto-Restart* untuk menangani isu *hang* pada *headless browser* Chromium di VPS.
  *Koneksi:* Meneruskan semua pesan WA yang masuk ke fungsi `handleIncomingMessage` di `agent.js`.

- **`agent/core/agent.js`**
  Ini adalah gerbang awal logika bot (Controller). Ketika pesan masuk, file ini akan mengambil riwayat percakapan pengguna dari `conversation_memory.js`, lalu mengirim pesan tersebut ke `ai_router.js` untuk dievaluasi intent-nya.
  *Koneksi:* Menjembatani `server.js`, `conversation_memory.js`, dan `ai_router.js`.

- **`agent/core/ai_router.js`**
  Bagian analitik (Brain). Menerima pesan dan menggunakan OpenAI (LLM) untuk menentukan **Intent** (Apa tujuan user?) dan **Action** (Apa yang harus dilakukan sistem?). Keputusannya (Routing Decision) menentukan modul mana yang harus dipanggil selanjutnya.
  *Koneksi:* Menerima input dari `agent.js`, dan memberikan *Routing Decision* ke `task_flow.js` dan `executor.js`.

- **`agent/core/executor.js`**
  Bagian tangan / alat (Tools). Jika `ai_router.js` memutuskan bahwa bot butuh mencari SOP pembuatan KTP di internet, maka `executor.js` bertugas menjalankan fungsi pencarian tersebut (misal via Tavily Search atau Vector Search).
  *Koneksi:* Digerakkan oleh instruksi *Action* dari Router, mengembalikan hasil pencarian (knowledge) ke *Task Flow*.

- **`agent/workflows/task_flow.js`**
  Orkestrator (Conductor). Mengatur alur (sequence) respons ke *user*. 
  Contoh Alur:
  1. Kirim balasan asinkron `"⏳ Sedang Goro proses ya pertanyaannya, ditunggu sebentar kak... 💡"` (Pesan loading dinamis)
  2. Minta `executor.js` mengeksekusi pencarian.
  3. Minta LLM menggabungkan hasil pencarian dengan pesan user.
  4. Kirim balasan akhir bahasa natural ke user WhatsApp.

## 3. Pengelolaan Data SOP & Knowledge Base

Agar Goro AI dapat menjawab pertanyaan layanan publik secara akurat, sistem ini menggunakan arsitektur gabungan **Statik dan Dinamis tersentralisasi (Supabase)**:

1. **Supabase Knowledge Center (Prioritas Utama)**:
   Semua data pengetahuan, FAQ, layanan, OPD, kontak, dan file dokumen disimpan di Supabase. Ini memungkinkan Admin mengubah jawaban bot secara *real-time* via Dashboard tanpa perlu *redeploy* aplikasi.
   *Alur Pencarian (Cascading)*: `executor.js` memanggil `supabase_provider.js` yang akan mencari berurutan: `Knowledge -> FAQ -> Services -> OPD -> Contacts -> Files`. Pencarian ini memiliki *cache* (TTL 5 menit) untuk efisiensi.

2. **Registry Statik (`config/opd_registry.js`)**: 
   Ini adalah pemetaan statis mengenai Organisasi Perangkat Daerah (OPD) untuk *fallback* eskalasi dan informasi dasar yang sangat jarang berubah.
   *Fungsi*: Membantu `ai_router.js` merutekan *intent* pertanyaan dengan cepat ke domain dinas yang relevan.

3. **Dinamis via Web Search (Tavily/DuckDuckGo) (Fallback Terakhir)**: 
   Jika informasi tidak ditemukan di Supabase, `executor.js` akan melakukan pencarian RAG (Retrieval-Augmented Generation) menggunakan API pencarian secara *real-time* ke web.

4. **Dinamis via Vector Store (`memory/vector_store/`) (Opsional)**: 
   Jika diaktifkan, ini adalah *fallback* sekunder sebelum Web Search untuk mencari kemiripan dari dokumen lokal. Namun prioritas utamanya saat ini ada di Supabase.

## Instruksi Tambahan Khusus untuk Agen AI (Developer Assistant)
Jika Anda (sistem AI) menganalisis repositori ini untuk melakukan perbaikan *code*:
- **Fokuslah pada struktur implementasi di atas** untuk memahami hubungan antarmodul.
- **Tone & Persona**: Modifikasi output/respons akhir bot (di `task_flow.js`) harus tetap mempertahankan gaya luwes, responsif, memanggil "kakak", dan kaya emotikon.
- **Infrastruktur**: DILARANG merusak logika di dalam `api/server.js` (khususnya Watchdog dan Chromium Cleanup). Logika ini terbukti stabil untuk PM2 di server Linux (VPS).
