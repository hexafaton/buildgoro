# 🚀 DEPLOY GORO AI KE VPS UBUNTU

Panduan lengkap deploy **GORO AI** ke VPS Ubuntu 20.04 / 22.04 / 24.04 LTS.

---

## Daftar Isi

1. [Persiapan Server](#1-persiapan-server)
2. [Install NodeJS](#2-install-nodejs)
3. [Install PM2](#3-install-pm2)
4. [Install Git](#4-install-git)
5. [Clone Repository](#5-clone-repository)
6. [Install Dependencies](#6-install-dependencies)
7. [Konfigurasi Environment](#7-konfigurasi-environment)
8. [Test Jalankan Aplikasi](#8-test-jalankan-aplikasi)
9. [Jalankan dengan PM2](#9-jalankan-dengan-pm2)
10. [Auto Startup PM2](#10-auto-startup-pm2)
11. [Reverse Proxy Nginx](#11-reverse-proxy-nginx)
12. [SSL Let's Encrypt](#12-ssl-lets-encrypt)
13. [Firewall UFW](#13-firewall-ufw)
14. [Monitoring Log](#14-monitoring-log)
15. [Restart Service](#15-restart-service)
16. [Update Project](#16-update-project)
17. [Backup & Restore](#17-backup--restore)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Persiapan Server

### Spesifikasi Minimum
- **RAM**: 2 GB (rekomendasi 4 GB)
- **CPU**: 1 vCPU (rekomendasi 2 vCPU)
- **Storage**: 20 GB SSD
- **OS**: Ubuntu 20.04 / 22.04 / 24.04 LTS
- **Akses**: SSH Root atau user dengan sudo

### Update Sistem

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Dependensi Dasar

```bash
sudo apt install -y curl wget build-essential ca-certificates gnupg lsb-release
```

---

## 2. Install NodeJS

Gunakan NodeSource repository untuk mendapatkan NodeJS versi LTS terbaru.

```bash
# Download dan install NodeSource setup script
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install NodeJS
sudo apt install -y nodejs

# Verifikasi
node --version
npm --version
```

**Output yang diharapkan:**
```
v20.x.x
10.x.x
```

---

## 3. Install PM2

PM2 adalah process manager untuk NodeJS yang memungkinkan aplikasi berjalan terus-menerus dan restart otomatis.

```bash
# Install PM2 secara global
sudo npm install -g pm2

# Verifikasi
pm2 --version
```

---

## 4. Install Git

```bash
sudo apt install -y git

# Verifikasi
git --version
```

---

## 5. Clone Repository

```bash
# Buat direktori untuk aplikasi
sudo mkdir -p /var/www
cd /var/www

# Clone repository
git clone https://github.com/USERNAME/chatbotGORO.git goro-ai

# Masuk ke direktori project
cd goro-ai
```

> **Catatan**: Ganti URL repository sesuai dengan repository Anda.

---

## 6. Install Dependencies

```bash
cd /var/www/goro-ai

# Install dependensi
npm install

# Install Chromium untuk WhatsApp Web (dibutuhkan oleh Puppeteer)
sudo apt install -y chromium-browser

# Jika chromium-browser tidak tersedia (Ubuntu 22.04+):
sudo snap install chromium
```

### Install Dependensi Tambahan Puppeteer

```bash
sudo apt install -y \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libgconf-2-4 \
    libasound2 \
    libatk1.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    xdg-utils
```

---

## 7. Konfigurasi Environment

```bash
cd /var/www/goro-ai

# Buat file .env dari contoh
cp .env.example .env   # atau buat manual

# Edit file .env
nano .env
```

Isi file `.env`:

```env
OPENAI_API_KEY=sk-xxxxx
WHATSAPP_PHONE_NUMBER=62xxxxxxxxxx
TAVILY_API_KEY=tvly-dev-xxxxx
WA_SYSTEM=baileys
PORT=5758
HEADLESS=true
```

> **PENTING**: Pastikan `PORT=5758` dan `HEADLESS=true`.

Simpan dan keluar: `Ctrl+X` → `Y` → `Enter`.

---

## 8. Test Jalankan Aplikasi

Jalankan manual terlebih dahulu untuk memastikan tidak ada error:

```bash
cd /var/www/goro-ai
node index.js
```

**Yang diharapkan:**
1. Muncul log `GORO AI — Asisten Layanan Publik Multi-OPD...`
2. Muncul QR Code di terminal
3. Scan QR Code dari WhatsApp di HP
4. Log menunjukkan `GORO AI WhatsApp berhasil terhubung`

Setelah berhasil, hentikan dengan `Ctrl+C`.

---

## 9. Jalankan dengan PM2

```bash
cd /var/www/goro-ai

# Jalankan dengan ecosystem config
pm2 start ecosystem.config.js --env production

# Cek status
pm2 status

# Lihat log real-time
pm2 logs goro-ai
```

**Output `pm2 status` yang diharapkan:**

```
┌─────────┬────┬─────────┬──────┬───────┬────────┬─────────┐
│ name    │ id │ mode    │ pid  │ status│ restart│ uptime  │
├─────────┼────┼─────────┼──────┼───────┼────────┼─────────┤
│ goro-ai │ 0  │ fork    │ 1234 │ online│ 0      │ 5s      │
└─────────┴────┴─────────┴──────┴───────┴────────┴─────────┘
```

---

## 10. Auto Startup PM2

Agar PM2 dan GORO AI otomatis berjalan saat server reboot:

```bash
# Generate script startup
pm2 startup

# PM2 akan menampilkan perintah yang harus dijalankan, contoh:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
# Jalankan perintah tersebut!

# Simpan daftar proses saat ini
pm2 save
```

---

## 11. Reverse Proxy Nginx

### Install Nginx

```bash
sudo apt install -y nginx
```

### Buat Konfigurasi Virtual Host

```bash
sudo nano /etc/nginx/sites-available/goro-ai
```

Isi dengan:

```nginx
server {
    listen 80;
    server_name goro-ai.example.com;  # Ganti dengan domain Anda

    location / {
        proxy_pass http://127.0.0.1:5758;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### Aktifkan Site

```bash
# Buat symlink
sudo ln -s /etc/nginx/sites-available/goro-ai /etc/nginx/sites-enabled/

# Test konfigurasi
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 12. SSL Let's Encrypt

### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Generate SSL Certificate

```bash
sudo certbot --nginx -d goro-ai.example.com
```

Ikuti instruksi interaktif:
1. Masukkan email
2. Setuju Terms of Service
3. Pilih redirect HTTP ke HTTPS (rekomendasi)

### Auto-Renewal

Certbot otomatis menambahkan cron job. Untuk verifikasi:

```bash
sudo certbot renew --dry-run
```

---

## 13. Firewall UFW

```bash
# Aktifkan UFW
sudo ufw enable

# Allow port yang dibutuhkan
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 5758/tcp    # GORO AI Monitor (opsional, jika akses langsung)

# Cek status
sudo ufw status verbose
```

**Output yang diharapkan:**

```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
5758/tcp                   ALLOW       Anywhere
```

> **Tips Keamanan**: Jika hanya akses via Nginx reverse proxy, Anda tidak perlu allow port 5758 di UFW. Port 5758 cukup diakses internal oleh Nginx.

---

## 14. Monitoring Log

### Log Real-Time

```bash
# Log semua output
pm2 logs goro-ai

# Hanya log error
pm2 logs goro-ai --err

# Log 100 baris terakhir
pm2 logs goro-ai --lines 100
```

### Dashboard Monitoring

```bash
pm2 monit
```

### Cek Health via Browser

Buka di browser:
- **Health**: `http://IP-SERVER:5758/api/health`
- **Status**: `http://IP-SERVER:5758/api/status`
- **Message Stats**: `http://IP-SERVER:5758/api/message-stats`
- **DB Status**: `http://IP-SERVER:5758/api/db-status`

---

## 15. Restart Service

```bash
# Restart GORO AI
pm2 restart goro-ai

# Restart dengan clear log
pm2 restart goro-ai --update-env

# Stop
pm2 stop goro-ai

# Start lagi
pm2 start goro-ai

# Reload (zero-downtime, jika memungkinkan)
pm2 reload goro-ai
```

---

## 16. Update Project

```bash
cd /var/www/goro-ai

# Pull perubahan terbaru
git pull origin main

# Install dependensi baru (jika ada)
npm install

# Restart aplikasi
pm2 restart goro-ai

# Verifikasi
pm2 status
pm2 logs goro-ai --lines 20
```

---

## 17. Backup & Restore

### Backup

```bash
# Backup file penting (exclude node_modules dan session)
cd /var/www
tar -czf goro-ai-backup-$(date +%Y%m%d).tar.gz \
    --exclude='goro-ai/node_modules' \
    --exclude='goro-ai/.wwebjs_auth' \
    --exclude='goro-ai/.wwebjs_cache' \
    goro-ai/

# Backup hanya .env
cp /var/www/goro-ai/.env ~/goro-ai-env-backup-$(date +%Y%m%d)
```

### Restore

```bash
cd /var/www

# Restore dari backup
tar -xzf goro-ai-backup-YYYYMMDD.tar.gz

# Install dependencies
cd goro-ai
npm install

# Jalankan
pm2 start ecosystem.config.js --env production
```

---

## 18. Troubleshooting

### Bot Tidak Mengirim Pesan

```bash
# Cek log
pm2 logs goro-ai --lines 50

# Cek apakah ada Chrome zombie
ps aux | grep chrom

# Kill Chrome zombie jika ada
pkill -f chromium
pkill -f "chrome --headless"

# Restart
pm2 restart goro-ai
```

### QR Code Tidak Muncul

```bash
# Hapus session lama
rm -rf /var/www/goro-ai/.wwebjs_auth

# Restart
pm2 restart goro-ai

# Monitor log untuk QR baru
pm2 logs goro-ai
```

### Port 5758 Sudah Digunakan

```bash
# Cek proses yang pakai port 5758
sudo lsof -i :5758

# Kill proses jika perlu
sudo kill -9 PID
```

### Memory Usage Tinggi

```bash
# Cek memory
pm2 monit

# Restart dengan limit memory (sudah diatur di ecosystem.config.js: 600M)
pm2 restart goro-ai
```

### Chromium Crash Saat Startup

```bash
# Install missing libraries
sudo apt install -y libgbm1 libnss3 libatk-bridge2.0-0

# Cek apakah chromium bisa dijalankan
chromium --headless --disable-gpu --dump-dom https://www.google.com
```

### PM2 Restart Loop

```bash
# Cek restart count
pm2 status

# Lihat alasan restart
pm2 logs goro-ai --err --lines 50

# Reset restart counter
pm2 reset goro-ai
```

---

## Catatan Penting

- **Session WhatsApp**: Setelah scan QR pertama kali, session disimpan di `.wwebjs_auth/`. Selama folder ini ada, bot tidak perlu scan QR lagi saat restart.
- **Jangan hapus `.wwebjs_auth/`** kecuali terjadi error autentikasi (`auth_failure`).
- **Database**: Saat ini database dinonaktifkan. Pada tahap pengembangan berikutnya, konfigurasi MariaDB/MySQL akan ditambahkan.
- **Port**: Gunakan port `5758` agar tidak bentrok dengan layanan lain.
