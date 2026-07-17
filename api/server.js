
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
    if (name === 'warning' && typeof data === 'object' && data.name === 'DeprecationWarning' && data.message.includes('punycode')) {
        return false;
    }
    return originalEmit.apply(process, arguments);
};

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { loadEnv } = require('../config/env');
const { handleIncomingMessage, resetBotStartTime, resetLastMessageTimestamp, getMessageStats } = require('../agent/core/agent');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

loadEnv();

console.log('[STARTUP] 🚀 GORO AI — Asisten Layanan Publik Multi-OPD Kabupaten Bojonegoro');
console.log('[STARTUP] Database dinonaktifkan sementara (akan diaktifkan di tahap berikutnya).');

const app = express();
const PORT = process.env.PORT || 3000;
let connectionStatus = 'connecting';
let currentQr = null;
let client = null;
let connectingStartedAt = Date.now(); // Timestamp saat mulai connecting (untuk timeout detection)

// === RESTART LOOP PROTECTION ===
// Mencegah bot restart tanpa henti jika ada error yang terus berulang
let restartCount = 0;
const MAX_RESTART_WITHIN_WINDOW = 5;        // Maksimal restart dalam window
const RESTART_WINDOW_MS = 5 * 60 * 1000;    // 5 menit window
let restartWindowStart = Date.now();
let lastRestartReason = '';

function canRestart(reason) {
    const now = Date.now();
    // Reset window jika sudah lewat
    if (now - restartWindowStart > RESTART_WINDOW_MS) {
        restartCount = 0;
        restartWindowStart = now;
    }
    restartCount++;
    lastRestartReason = reason || 'unknown';

    if (restartCount > MAX_RESTART_WITHIN_WINDOW) {
        console.error(`[GUARD] ❌ RESTART LOOP TERDETEKSI! ${restartCount} restart dalam 5 menit terakhir (reason: ${lastRestartReason}). Menunggu cooldown 2 menit...`);
        return false;
    }
    return true;
}

function startWhatsAppClient() {
  // PRE-LAUNCH: Bersihkan lock files yang mungkin tersisa dari crash sebelumnya
  cleanupLockFiles();

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'default-client'
    }),
    puppeteer: {
      headless: true,
      protocolTimeout: 300000, // 5 minutes timeout for slow injections
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-accelerated-2d-canvas',
        '--disable-software-rasterizer',
        '--proxy-server=direct://',
        '--proxy-bypass-list=*',
        '--mute-audio',
        '--no-first-run',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update'
      ]
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    webVersionCache: {
      type: 'none'
    }
  });

  client.on('qr', (qr) => {
    console.log('\n=== SCAN QR CODE BERIKUT UNTUK AI AGENT ===');
    qrcode.generate(qr, { small: true });
    console.log('Gunakan WhatsApp app untuk scan (hanya perlu 1x)');
    console.log('[MONITOR] 💡 Jika QR code di atas rusak/tidak muncul di terminal Anda (karena encoding Windows),');
    console.log(`          silakan buka halaman monitor web di browser Anda: http://localhost:${PORT}`);
    console.log('=====================================\n');
    
    currentQr = qr;
    connectionStatus = 'qr';
  });

  client.on('ready', () => {
    console.log('[READY] ✅ GORO AI WhatsApp berhasil terhubung. Menunggu pesan masuk...');
    currentQr = null;
    connectionStatus = 'ready';
    connectingStartedAt = null; // Clear — sudah tidak connecting lagi
    // Reset restart counter saat berhasil ready — artinya kondisi sudah stabil
    restartCount = 0;
    restartWindowStart = Date.now();
    // PENTING: Reset botStartTime agar pesan baru tidak terfilter oleh timestamp lama
    resetBotStartTime();
    // PENTING: Reset lastMessageReceivedAt agar Watchdog tidak langsung restart lagi
    // karena membaca timestamp idle dari sesi sebelumnya
    resetLastMessageTimestamp();
  });

  // === MONITOR STATE KONEKSI WA ===
  // Mendeteksi perubahan state koneksi WhatsApp (CONNECTED, OPENING, PAIRING, TIMEOUT, dll)
  client.on('change_state', (state) => {
    console.log(`[WA STATE] 🔄 Koneksi WhatsApp berubah state: ${state}`);
    if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'UNPAIRED') {
      console.warn(`[WA STATE] ⚠️ State kritis terdeteksi: ${state}. Kemungkinan sesi bermasalah.`);
    }
  });

  client.on('message', async (message) => {
    try {
      await handleIncomingMessage(message, client);
    } catch (error) {
      console.error('[ERROR] Gagal memproses pesan di GORO AI:', error.message || error);
    }
  });

  client.on('disconnected', async (reason) => {
    console.log('[ERROR] AI Agent terputus (disconnected):', reason);
    restartClient('disconnected: ' + reason);
  });

  client.on('authenticated', () => {
    console.log('[AUTH] Autentikasi berhasil. Session AI Agent disimpan.');
    connectionStatus = 'authenticated';
  });

  client.on('auth_failure', async (msg) => {
    console.error('[ERROR] Autentikasi gagal (auth_failure):', msg);
    // HANYA hapus session saat auth_failure — bukan setiap restart
    await deleteSessionFolder('auth_failure');
    restartClient('auth_failure');
  });

  client.initialize().catch((err) => {
    console.error('[ERROR] Gagal inisialisasi AI Agent:', err);
    connectionStatus = 'disconnected';
    restartClient('init_failure: ' + (err.message || err));
  });
}

/**
 * Hapus folder session WhatsApp.
 * Dipanggil HANYA saat auth_failure, BUKAN setiap restart biasa.
 * Ini mencegah bot terjebak di loop QR Code.
 */
async function deleteSessionFolder(reason) {
  const sessionPath = path.join(__dirname, '../.wwebjs_auth');
  if (!fs.existsSync(sessionPath)) return;

  console.log(`[SYSTEM] Menghapus folder session karena: ${reason}`);
  
  // Jeda agar OS melepas file lock
  await new Promise(resolve => setTimeout(resolve, 1500));

  let deleted = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`[SYSTEM] Folder session lama berhasil dihapus pada percobaan #${attempt}.`);
      deleted = true;
      break;
    } catch (e) {
      console.warn(`[SYSTEM] Percobaan #${attempt} menghapus folder session gagal: ${e.message}. Mencoba lagi dalam 500ms...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!deleted) {
    console.error('[SYSTEM] ❌ Gagal menghapus folder session setelah 5 percobaan.');
  }
}

/**
 * Hapus lock files dari Chrome userDataDir.
 * Lock files ini dibuat Chrome saat launch dan seharusnya dihapus saat exit.
 * Jika Chrome di-kill paksa (SIGKILL), lock files tidak terhapus dan
 * menyebabkan error "browser is already running" pada launch berikutnya.
 */
function cleanupLockFiles() {
  const sessionDir = path.join(__dirname, '../.wwebjs_auth/session-default-client');
  
  if (!fs.existsSync(sessionDir)) {
    console.log('[CLEANUP] Session directory tidak ada, skip cleanup lock files.');
    return;
  }

  const lockFileNames = [
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie',
  ];

  let cleaned = 0;
  for (const lockFile of lockFileNames) {
    const lockPath = path.join(sessionDir, lockFile);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        cleaned++;
        console.log(`[CLEANUP] 🗑️ Lock file dihapus: ${lockFile}`);
      }
    } catch (err) {
      console.warn(`[CLEANUP] ⚠️ Gagal hapus ${lockFile}: ${err.message}`);
    }
  }

  // Hapus juga file .lock lainnya di dalam profile
  try {
    const files = fs.readdirSync(sessionDir);
    for (const file of files) {
      if (file.endsWith('.lock') || file === 'lockfile') {
        const lockPath = path.join(sessionDir, file);
        try {
          fs.unlinkSync(lockPath);
          cleaned++;
          console.log(`[CLEANUP] 🗑️ Lock file dihapus: ${file}`);
        } catch (err) {
          // Ignore individual file errors
        }
      }
    }
  } catch (err) {
    // Ignore readdir errors
  }

  if (cleaned > 0) {
    console.log(`[CLEANUP] ✅ Total ${cleaned} lock file(s) dibersihkan.`);
  } else {
    console.log('[CLEANUP] Tidak ada lock file yang perlu dibersihkan.');
  }
}

/**
 * Kill semua proses Chromium/Chrome yang mungkin menjadi zombie.
 * Strategy: SIGTERM dulu (beri waktu cleanup), baru SIGKILL jika masih hidup.
 */
async function forceKillChromium() {
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM chrome.exe /T 2>nul', { timeout: 5000 });
      execSync('taskkill /F /IM chromium.exe /T 2>nul', { timeout: 5000 });
    } catch (err) { /* no matching processes */ }
    console.log('[SYSTEM] 🔪 Force-kill Chromium (Windows) selesai.');
    return;
  }

  // Linux: SIGTERM dulu, tunggu, baru SIGKILL
  try {
    // Step 1: SIGTERM — beri Chrome kesempatan cleanup lock files
    execSync('pkill -15 -f chromium 2>/dev/null || true', { timeout: 5000 });
    execSync('pkill -15 -f "chrome --headless" 2>/dev/null || true', { timeout: 5000 });
    console.log('[SYSTEM] Mengirim SIGTERM ke Chrome processes...');
  } catch (err) { /* no matching processes */ }

  // Tunggu Chrome shutdown gracefully
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 2: Cek apakah masih ada yang hidup
  try {
    const remaining = execSync(
      'pgrep -f "chrom(e|ium)" 2>/dev/null || true',
      { timeout: 3000, encoding: 'utf8' }
    ).trim();

    if (remaining) {
      console.warn('[SYSTEM] Chrome masih hidup setelah SIGTERM. Mengirim SIGKILL...');
      execSync('pkill -9 -f chromium 2>/dev/null || true', { timeout: 5000 });
      execSync('pkill -9 -f "chrome --headless" 2>/dev/null || true', { timeout: 5000 });
      // Tunggu OS benar-benar membersihkan proses
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) { /* no matching processes */ }

  console.log('[SYSTEM] 🔪 Chrome cleanup selesai.');
}

/**
 * Destroy client dengan timeout.
 * Jika client.destroy() hang lebih dari 15 detik, force-kill Chromium.
 * SELALU cleanup lock files setelah destroy (baik sukses maupun gagal).
 */
async function safeDestroyClient() {
  if (!client) return;

  const DESTROY_TIMEOUT_MS = 15000;

  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('destroy() timeout after 15s')), DESTROY_TIMEOUT_MS)
      )
    ]);
    console.log('[SYSTEM] Browser lama berhasil dibersihkan via destroy().');
  } catch (err) {
    console.warn(`[SYSTEM] ⚠️ client.destroy() gagal/timeout: ${err.message}. Force-killing Chromium...`);
    await forceKillChromium();
  }

  // CRITICAL: Selalu cleanup lock files, bahkan jika destroy() sukses
  cleanupLockFiles();

  // Nullify client reference untuk mencegah re-use
  client = null;
}

async function restartClient(reason) {
  if (connectionStatus === 'restarting') return;
  connectionStatus = 'restarting';
  connectingStartedAt = null;
  console.log(`\n[SYSTEM] Terdeteksi masalah (${reason || 'unknown'}). Merestart WhatsApp client...`);
  currentQr = null;
  
  // Cek apakah boleh restart (loop protection)
  if (!canRestart(reason)) {
    console.error('[GUARD] Menunggu cooldown 2 menit sebelum restart berikutnya...');
    setTimeout(async () => {
      restartCount = 0;
      restartWindowStart = Date.now();
      
      // Pastikan Chrome benar-benar mati sebelum restart setelah cooldown
      await forceKillChromium();
      cleanupLockFiles();
      
      connectionStatus = 'connecting';
      connectingStartedAt = Date.now();
      startWhatsAppClient();
    }, 2 * 60 * 1000);
    return;
  }

  // Gunakan safe destroy dengan timeout
  await safeDestroyClient();

  // Jeda waktu agar OS benar-benar melepas resource
  console.log('[SYSTEM] Menunggu 5 detik untuk membebaskan resource...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Verifikasi Chrome benar-benar mati
  if (process.platform !== 'win32') {
    try {
      const chromeProcs = execSync(
        'pgrep -c -f "chrom(e|ium)" 2>/dev/null || echo "0"',
        { timeout: 3000, encoding: 'utf8' }
      ).trim();
      
      if (parseInt(chromeProcs) > 0) {
        console.warn(`[SYSTEM] ⚠️ Masih ada ${chromeProcs} Chrome process! Force cleanup...`);
        await forceKillChromium();
        cleanupLockFiles();
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log('[SYSTEM] ✅ Tidak ada Chrome process tersisa.');
      }
    } catch (err) {
      // pgrep not found or error — proceed anyway
    }
  }

  // PENTING: Folder session TIDAK dihapus di sini.
  // Session hanya dihapus saat auth_failure (lihat handler auth_failure di atas).
  // Ini memungkinkan bot reconnect tanpa perlu scan QR ulang.

  const delaySeconds = Math.min(7 + (restartCount * 3), 30);
  console.log(`[SYSTEM] Memulai ulang client dalam ${delaySeconds} detik...\n`);
  setTimeout(() => {
    connectionStatus = 'connecting';
    connectingStartedAt = Date.now();
    startWhatsAppClient();
  }, delaySeconds * 1000);
}

// Mulai client pertama kali
startWhatsAppClient();

// === GLOBAL ERROR HANDLERS ===
// Menangkap SEMUA uncaught exception dan unhandled rejection agar process TIDAK mati

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
  const msg = err && err.message ? err.message : String(err);

  // Khusus error Puppeteer browser crash — restart client
  if (msg.includes('Execution context was destroyed') || 
      msg.includes('Protocol error') || 
      msg.includes('Session closed') ||
      msg.includes('Target closed') ||
      msg.includes('Navigation failed')) {
    if (connectionStatus === 'ready') {
      console.log('[SYSTEM] Terdeteksi crash browser pada sesi aktif. Menjalankan restart...');
      restartClient('browser_crash: ' + msg.substring(0, 100));
    } else {
      console.log('[SYSTEM] Mengabaikan browser exception selama fase inisialisasi.');
    }
    return; // Jangan biarkan process exit
  }

  // Error lain: LOG tapi JANGAN exit — biarkan process tetap hidup
  console.error('[SYSTEM] Error non-fatal tertangkap. Process tetap berjalan.');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
  const msg = reason && reason.message ? reason.message : String(reason);

  // Khusus error Puppeteer browser crash — restart client
  if (msg.includes('Execution context was destroyed') || 
      msg.includes('Protocol error') || 
      msg.includes('Session closed') ||
      msg.includes('Target closed') ||
      msg.includes('Navigation failed')) {
    if (connectionStatus === 'ready') {
      console.log('[SYSTEM] Terdeteksi crash browser pada sesi aktif. Menjalankan restart...');
      restartClient('browser_crash_rejection: ' + msg.substring(0, 100));
    } else {
      console.log('[SYSTEM] Mengabaikan browser rejection selama fase inisialisasi.');
    }
    return;
  }

  // Error lain: LOG tapi JANGAN exit
  console.error('[SYSTEM] Rejection non-fatal tertangkap. Process tetap berjalan.');
});

// === GRACEFUL SHUTDOWN ===
// Membersihkan resource saat PM2 mengirim sinyal stop

async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Menerima sinyal ${signal}. Membersihkan resource...`);
  
  try {
    // Gunakan safeDestroyClient() yang sudah ada timeout + lock cleanup
    await safeDestroyClient();
    console.log('[SHUTDOWN] WhatsApp client ditutup.');
  } catch (err) {
    console.log('[SHUTDOWN] Gagal menutup client:', err.message);
    // Fallback: force kill + cleanup
    await forceKillChromium();
    cleanupLockFiles();
  }

  console.log('[SHUTDOWN] ✅ Shutdown selesai. Selamat tinggal!');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// === HEALTH MONITORING ===
// Log status kesehatan setiap 30 menit agar mudah debugging dari PM2 logs

setInterval(() => {
  const memUsage = process.memoryUsage();
  const memMB = Math.round(memUsage.rss / 1024 / 1024);
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const uptimeMin = Math.round(process.uptime() / 60);
  const stats = getMessageStats();
  console.log(`[HEALTH] Status: ${connectionStatus} | Memory: ${memMB}MB (heap: ${heapMB}MB) | Uptime: ${uptimeMin}m | Restarts: ${restartCount} | Pesan: ${stats.totalProcessed}/${stats.totalReceived} (err: ${stats.totalErrors}, timeout: ${stats.totalTimeouts})`);
}, 30 * 60 * 1000);

// === SOLUSI A: ACTIVE CONNECTION HEALTH CHECK ===
// Ping koneksi WhatsApp setiap 5 menit untuk deteksi silent disconnect.
// Jika client.getState() gagal atau return selain 'CONNECTED' sebanyak 3x berturut-turut,
// otomatis restart client untuk memulihkan koneksi.
const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
let consecutivePingFailures = 0;
const MAX_PING_FAILURES = 3; // Restart setelah 3x gagal berturut-turut

setInterval(async () => {
  if (connectionStatus !== 'ready' || !client) return;

  try {
    const state = await client.getState();

    if (state === 'CONNECTED') {
      if (consecutivePingFailures > 0) {
        console.log(`[PING] ✅ Koneksi WhatsApp pulih (state: ${state}). Reset failure counter.`);
      }
      consecutivePingFailures = 0;
    } else {
      consecutivePingFailures++;
      console.warn(`[PING] ⚠️ State tidak CONNECTED: ${state} (failure ${consecutivePingFailures}/${MAX_PING_FAILURES})`);

      if (consecutivePingFailures >= MAX_PING_FAILURES) {
        console.error(`[PING] ❌ ${MAX_PING_FAILURES}x ping gagal berturut-turut. Memulai restart...`);
        consecutivePingFailures = 0;
        restartClient('ping_failed_' + state);
      }
    }
  } catch (err) {
    consecutivePingFailures++;
    console.error(`[PING] ❌ Ping error (failure ${consecutivePingFailures}/${MAX_PING_FAILURES}):`, err.message);

    if (consecutivePingFailures >= MAX_PING_FAILURES) {
      console.error(`[PING] ❌ ${MAX_PING_FAILURES}x ping exception berturut-turut. Memulai restart...`);
      consecutivePingFailures = 0;
      restartClient('ping_exception: ' + (err.message || '').substring(0, 80));
    }
  }
}, PING_INTERVAL_MS);

// === SOLUSI C: CONNECTING TIMEOUT GUARD ===
// Deteksi jika bot stuck di status 'connecting' terlalu lama (Puppeteer hang, dll).
// Cek setiap 1 menit. Jika connecting lebih dari 5 menit tanpa menjadi 'ready',
// otomatis force-restart. Ini melengkapi Solusi A (Ping) dan Solusi B (Watchdog)
// yang hanya bekerja saat status sudah 'ready'.
const CONNECTING_TIMEOUT_MS = 5 * 60 * 1000;  // 5 menit timeout connecting
const CONNECTING_CHECK_INTERVAL_MS = 60 * 1000; // Cek setiap 1 menit

setInterval(() => {
  // Hanya cek saat status connecting DAN ada timestamp
  if (connectionStatus !== 'connecting' || !connectingStartedAt) return;

  const connectingDurationMs = Date.now() - connectingStartedAt;
  const connectingDurationMin = Math.round(connectingDurationMs / 1000 / 60);

  if (connectingDurationMs >= CONNECTING_TIMEOUT_MS) {
    console.error(`[CONNECT-GUARD] ❌ Status 'connecting' sudah ${connectingDurationMin} menit tanpa berhasil ready!`);
    console.error('[CONNECT-GUARD] Kemungkinan Puppeteer/Chromium hang. Melakukan force restart...');
    connectingStartedAt = null; // Prevent re-trigger saat masih restarting
    restartClient('connecting_timeout_' + connectingDurationMin + 'm');
  } else {
    console.log(`[CONNECT-GUARD] ⏳ Menunggu koneksi... (${connectingDurationMin} menit, timeout: ${CONNECTING_TIMEOUT_MS / 60000} menit)`);
  }
}, CONNECTING_CHECK_INTERVAL_MS);

// === SOLUSI B: WATCHDOG DENGAN AUTO-RECOVERY ===
// Cek setiap 15 menit. Jika status ready tapi tidak ada pesan masuk selama 2 jam
// di jam kerja (07:00-17:00 WIB), otomatis restart sebagai safety net.
// Di luar jam kerja, hanya log info tanpa restart.
const WATCHDOG_MAX_IDLE_MINUTES = 120; // 2 jam threshold untuk auto-restart

setInterval(() => {
  if (connectionStatus !== 'ready') return;
  const stats = getMessageStats();
  const now = new Date();

  if (stats.lastMessageReceivedAt) {
    const lastReceivedAgo = Math.round((now - new Date(stats.lastMessageReceivedAt)) / 1000 / 60);
    const lastProcessedAgo = stats.lastMessageProcessedAt
      ? Math.round((now - new Date(stats.lastMessageProcessedAt)) / 1000 / 60)
      : 'never';

    // Log statistik pesan
    console.log(`[WATCHDOG] Status: received=${stats.totalReceived} processed=${stats.totalProcessed} filtered=${stats.totalFiltered} errors=${stats.totalErrors} timeouts=${stats.totalTimeouts} | Last received: ${lastReceivedAgo}m ago | Last processed: ${lastProcessedAgo}${typeof lastProcessedAgo === 'number' ? 'm ago' : ''}`);

    // Deteksi pesan stuck (received > processed + filtered + errors + timeouts)
    if (stats.totalReceived > stats.totalProcessed + stats.totalFiltered + stats.totalErrors + stats.totalTimeouts) {
      console.warn(`[WATCHDOG] ⚠️ Ada gap antara pesan diterima (${stats.totalReceived}) dan diproses+difilter (${stats.totalProcessed + stats.totalFiltered}). Kemungkinan ada pesan yang stuck.`);
    }

    // Auto-recovery: restart jika idle terlalu lama SAAT JAM KERJA
    const currentHour = now.getHours();
    const isWorkHours = currentHour >= 7 && currentHour <= 17; // 07:00 - 17:00

    if (isWorkHours && lastReceivedAgo > WATCHDOG_MAX_IDLE_MINUTES && stats.totalReceived > 0) {
      console.warn(`[WATCHDOG] ⚠️ Idle ${lastReceivedAgo} menit saat jam kerja (${currentHour}:00). Melakukan preventive restart...`);
      restartClient('watchdog_idle_' + lastReceivedAgo + 'm');
      return;
    }

    // Di luar jam kerja, hanya log info
    if (lastReceivedAgo > 15 && stats.totalReceived > 0) {
      console.log(`[WATCHDOG] ℹ️ Tidak ada pesan masuk ${lastReceivedAgo} menit. Bot mungkin idle (normal jika di luar jam kerja).`);
    }
  }
}, 15 * 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', async (req, res) => {
  let qrDataUrl = null;
  if (currentQr) {
    try {
      qrDataUrl = await QRCode.toDataURL(currentQr, {
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' }
      });
    } catch (e) {
      console.error('[QR] Gagal generate QR data URL:', e.message);
    }
  }
  res.json({
    status: connectionStatus,
    qr: qrDataUrl
  });
});

app.get('/api/db-status', async (req, res) => {
  // Database dinonaktifkan sementara
  res.json({
    mariadb_local: 'disabled',
    api_bridge_rumahweb: 'disabled',
    message: 'Database akan diaktifkan pada tahap pengembangan berikutnya',
    timestamp: new Date().toISOString()
  });
});

// Endpoint monitoring kesehatan untuk cek via browser
app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  // Lazy load monitoring untuk menghindari circular dependency
  let monitoringMetrics = {};
  try {
    const { getMetrics } = require('../utils/monitoring');
    monitoringMetrics = getMetrics();
  } catch (e) { }

  let activeSessionCount = 0;
  try {
    const { getActiveCount } = require('../agent/core/conversation_memory');
    activeSessionCount = getActiveCount();
  } catch (e) { }

  res.json({
    status: connectionStatus,
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(memUsage.rss / 1024 / 1024),
    heap_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
    active_sessions: activeSessionCount,
    restart_count: restartCount,
    last_restart_reason: lastRestartReason || 'none',
    cache: monitoringMetrics.cache || {},
    api: monitoringMetrics.api || {},
    timestamp: new Date().toISOString()
  });
});

// Endpoint monitoring statistik pesan — untuk diagnostik bug "diam"
app.get('/api/message-stats', (req, res) => {
  const stats = getMessageStats();
  res.json({
    ...stats,
    connection_status: connectionStatus,
    uptime_minutes: Math.round(process.uptime() / 60),
    timestamp: new Date().toISOString()
  });
});

// Endpoint monitoring detail (metrics lengkap)
app.get('/api/monitoring', (req, res) => {
  try {
    const { getMetrics } = require('../utils/monitoring');
    res.json(getMetrics());
  } catch (e) {
    res.json({ error: 'Monitoring module not available', message: e.message });
  }
});

const host = process.env.MONITOR_IP || '127.0.0.1';
app.listen(PORT, host, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 GORO AI MONITOR AKTIF DI: http://${host}:${PORT}`);
  console.log(`======================================================\n`);
});

