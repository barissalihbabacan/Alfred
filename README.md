<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="B.U.T.L.E.R. Alfred — Barış's Unified Task, Logic, Execution &amp; Reasoning">
</p>

<p align="center">
  <strong>B.U.T.L.E.R. Alfred</strong> (<em>Barış's Unified Task, Logic, Execution &amp; Reasoning</em>), kişisel bilişsel operasyonları yönetmek, karmaşık mühendislik ve günlük iş akışlarını koordine etmek üzere tasarlanmış otonom bir yapay zeka yürütme mimarisidir.
</p>

<p align="center">
  <a href="#hızlı-başlangıç"><img src="https://img.shields.io/badge/durum-stabil_milestone-10b981?style=flat-square" alt="Durum"></a>
  <a href="#test--doğrulama"><img src="https://img.shields.io/badge/testler-23%2F23_geçti-10b981?style=flat-square" alt="Testler"></a>
  <a href="#yerel-ses-sistemi-kokoro-82m"><img src="https://img.shields.io/badge/tts-Kokoro--82M_(bm__george)-c5a059?style=flat-square" alt="TTS"></a>
  <a href="#yapay-zeka-sağlayıcı-altyapısı-groq-lpu"><img src="https://img.shields.io/badge/ai_sağlayıcı-Groq_LPU-f59e0b?style=flat-square" alt="AI"></a>
  <a href="#web-sesli--yazılı-etkileşim-oyun-alanı"><img src="https://img.shields.io/badge/arayüz-Next.js_14_App_Router-3b82f6?style=flat-square" alt="Arayüz"></a>
  <a href="#firebase-dağıtım-mimarisi"><img src="https://img.shields.io/badge/dağıtım-Firebase_Hosting-ea580c?style=flat-square" alt="Firebase"></a>
</p>

---

## Projenin Amacı ve Felsefesi

Alfred, pasif bir sohbet botu veya her komutu körü körüne onaylayan bir "yes-man" değildir. Modern bir İngiliz beyefendisi ve geleneksel ev kâhyası disipliniyle donatılmış; sakin, ölçülü, yüksek yetkinlikte ve risk bilincine sahip bir bilişsel operasyon ortağıdır:

- **Bilişsel Yük Yönetimi**: Projeler arasındaki bağımlılıkları, açık görevleri ve kritik kararları takip ederek zihinsel dağınıklığı ortadan kaldırır.
- **Koruyucu Karşı Duruş (Pushback)**: Yıkıcı veya riskli bir eylem (örneğin canlı veritabanını silmek, güvenlik kontrollerini devre dışı bırakmak) önerildiğinde itiraz eder; operasyonel riskleri açıklayarak güvenli alternatifler sunar.
- **Sağlayıcı Bağımsızlığı (Vendor-Agnostic)**: Hiçbir bulut sağlayıcısına kalıcı bağımlılık geliştirmez. Yapay zeka modelleri ve ses motorları arayüz seviyesinde soyutlanmıştır.
- **Yerel ve Gizlilik Odaklı Ses**: Ücretli bulut ses servisleri yerine %100 yerel ve çevrimdışı çalışan açık kaynaklı nöral ses modellerini kullanır.

---

## Web Sesli & Yazılı Etkileşim Oyun Alanı

Projenin ilk çalışan dikey dilimi olan **Web Voice & Chat Playground** (`apps/web/`), tarayıcı üzerinden Alfred ile gerçek zamanlı çift modlu etkileşim sağlar:

```
           [Klavye Metin Girişi]            [Canlı Mikrofon Girişi]
                     │                                 │
                     │                     MediaRecorder (Opus / WebM)
                     │                                 │
                     │                          POST /api/stt
                     │                                 │
                     │                        Groq Whisper STT
                     │                    (whisper-large-v3-turbo)
                     │                                 │
                     └────────────────┬────────────────┘
                                      │
                               Metin Transkripti
                                      │
                                      ▼
                                 POST /api/chat (SSE Stream)
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
           Ollama Yerel Çıkarım                 Groq Cloud LPU
        (gemma4:12b-mlx via Tailscale)    (llama-3.3-70b-versatile)
                      │                                 │
                      ├─► Düşünce Tokenları (thinking)  │
                      │     └─► Arayüz: "Thinking..."   │
                      │                                 │
                      └─► İçerik Tokenları (content) ───┘
                                       │
                                       ▼ (SSE: text/event-stream)
                      ┌─────────────────────────────────┐
                      │     Gerçek Zamanlı Akış (UI)    │
                      │  - "Thinking..." puls gösterge  │
                      │  - Kademeli metin akışı (TTFT)  │
                      │  - Güvenli Markdown ayrıştırma  │
                      │  - Kesinti korumalı tampon      │
                      └─────────────────────────────────┘
```

### ⚡ Gerçek Zamanlı Akış & "Thinking..." Durum Makinesi
Oyun Alanı (`apps/web/`), istek/yanıt modeli yerine Server-Sent Events (SSE) tabanlı gerçek zamanlı bir akış mimarisine sahiptir:
- **Düşünce İzolasyonu (Gemma 4)**: Gemma 4 modelleri yanıt oluşturmadan önce kendi içinde muhakeme/düşünce tokenları (`message.thinking`) üretir. Arka uç bu tokenları yakalar ve kullanıcıya asla iç düşünceleri göstermeden yalnızca `{ type: "thinking" }` sinyali iletir.
- **Arayüz Geçişi**: Sohbet balonunda beliren zarif üç noktalı "Thinking..." göstergesi, ilk gerçek yanıt tokenı (TTFT) ulaştığı anda gecikmesiz olarak kademeli metin akışına evrilir.
- **Kademeli Markdown & Kesinti Koruması**: `**kalın**`, kod blokları ve listeler akış sırasında parçalanmadan güvenle derlenir. Bağlantı kesilirse o ana kadar üretilen yanıt kaybolmaz (`[Response interrupted]`).

### ⚡ Oyun Alanında Ses Sentezi (Kokoro-82M) Tasarım Kararı
> **Tasarım Kararı**: Alfred'in detaylı, teknik ve uzun yanıtlarında metinden-sese (TTS) dönüştürme hem çıkarım gecikmesini artırmakta hem de uzun konuşmaları dinlemeyi sıkıcı ve verimsiz hale getirmekteydi. Bu nedenle Web Oyun Alanında (`apps/web/`) otomatik Kokoro seslendirmesi doğrudan kaldırılmıştır. Arayüz; anlık, akıcı ve güvenli Markdown (`**kalın**`, `*italik*`, kod blokları) destekli hızlı metin okuma ve gerçek zamanlı token akışı deneyimine odaklanmıştır. Kokoro-82M ses motoru mimari çekirdekte (`src/voice/providers/kokoro/`) çevrimdışı CLI araçları ve toplu sentezleme testleri için korunmaktadır.

### Arayüz Durum Göstergesi

Oyun alanında durum anlık olarak üst bilgi rozetinden izlenebilir:
- `● Ready`: Sistem hazır, kullanıcı girdisi bekliyor.
- `● Listening...`: Mikrofon aktif, ses dalgası kaydediliyor.
- `● Transcribing audio...`: Whisper STT ses kaydını metne dönüştürüyor.
- `● Thinking...`: Model mantıksal muhakeme (reasoning) evresinde; iç düşünceler kullanıcıya yansıtılmaksızın arka planda işleniyor.
- `● Alfred is responding...`: İlk içerik tokenı ile birlikte anlık metin akışı gerçekleşiyor.
- `● Error`: Güvenli ve maskelenmiş kullanıcı bilgilendirme uyarısı.

---

## Sistem Mimarisi

<p align="center">
  <img src="./assets/readme/architecture.svg" width="100%" alt="B.U.T.L.E.R. Alfred Sistem Mimarisi">
</p>

Proje, bağımsız katmanlar ve net sorumluluk sınırları üzerine kuruludur:

| Katman | Dizin | Temel Sorumluluk |
| :--- | :--- | :--- |
| **Persona Katmanı** | `src/alfred/persona/` | İngiliz kâhyası üslubu, ölçülü hitap, kuru mizah ve koruyucu karşı duruş kuralları. |
| **Bilişsel Katman** | `src/alfred/cognitive/` | Bağlam izleme, çalışma belleği, uzun dönemli bellek, projeler ve karar kütükleri. |
| **Kontrol Düzlemi** | `src/alfred/control-plane/` | Otonom görev planlama, araç yönlendirme (`tool-router`), zamanlayıcı ve izin hiyerarşisi. |
| **Yürütme Düzlemi** | `src/alfred/execution-plane/` | GitHub, Gmail, Google Takvim, yerel dosya sistemi, terminal ve web arama adaptörleri. |
| **Yapay Zeka Katmanı** | `src/ai/` | Sağlayıcı bağımsız `AIProvider` arayüzü, dinamik kayıt defteri (`registry`) ve Groq LPU sürücüsü. |
| **Ses Katmanı** | `src/voice/` | Whisper STT adaptörü, `TTSService` cephesi, ses profilleri ve yerel Kokoro-82M motoru. |
| **Veri Katmanı** | `src/data/` | Cloud Firestore, yerel vektör veri tabanı ve depo (repository) soyutlamaları. |
| **Web Oyun Alanı** | `apps/web/` | Next.js 14 App Router, çift modlu kullanıcı arayüzü, API uç noktaları ve ses oynatma. |

---

## Yerel Ses Sistemi (Kokoro-82M)

Alfred'in konuşma yeteneği harici bir bulut servisine veya API anahtarına ihtiyaç duymaz:

- **Model**: `onnx-community/Kokoro-82M-v1.0-ONNX` (8-bit kuantize `q8`, ~85MB).
- **Seçilen Ses**: **`bm_george`** — Olgun, Received Pronunciation (RP) aksanına sahip, sakin ve saygılı İngiliz erkek kâhya sesi.
- **Ses Profili Soyutlaması**: `ALFRED_DEFAULT_VOICE_PROFILE`, karakterin vokal özelliklerini (tempo, dil, enerji) ses motorundan ayırır; ileride alternatif sağlayıcıların mimariyi bozmadan eklenmesini sağlar.
- **Ses Formatı**: 24,000 Hz, 16-bit mono PCM doğrusal WAV formatı.
- **Yerel Sentez Testi**:
  ```bash
  # 6 standart Alfred kâhya cümlesini audio_output/ dizinine sentezle
  npm run test:tts

  # Sentezle ve sistem ses aygıtından doğrudan dinlet (paplay, aplay, afplay)
  npm run test:tts -- --play
  ```

> [!NOTE]
> **Web Oyun Alanı Notu**: Web arayüzünde (`apps/web/`) uzun cevaplarda oluşan dinleme yorgunluğunu önlemek ve anlık metin akışı sağlamak amacıyla otomatik seslendirme kaldırılmıştır. Kokoro-82M motoru mimaride korunmakta olup yukarıdaki CLI komutlarıyla yerel olarak çalıştırılabilir ve test edilebilir.

## Yapay Zeka Sağlayıcı Altyapısı (Groq LPU & Ollama Local)

Alfred'in bilişsel çekirdeği sağlayıcı bağımsız bir sözleşmeyle (`AIProvider`) çalışır ve iki güçlü çıkarım motorunu destekler:

```
                          Alfred Runtime
                                │
                           AIProvider
                                ├── OllamaProvider (Yerel / Tailscale Özel Ağı)
                                └── GroqProvider   (Bulut / LPU Ultra Hızlı)
```

### 1. Yerel Ollama Motoru (`src/ai/providers/ollama/`)
Geliştirme ve yerel testlerde varsayılan LLM sağlayıcısıdır:
- **Varsayılan Model**: **`gemma4:12b-mlx`** (`OLLAMA_MODEL`)
- **Uç Nokta**: `http://100.64.0.53:11434` (`OLLAMA_BASE_URL`, Tailscale özel ağı üzerinden)
- **Sağlık & Teşhis**: `/api/health` uç noktası ve `checkHealth()` metodu sunucu erişilebilirliğini ve model varlığını tarayıcıya iç ağ detaylarını sızdırmadan raporlar.
- **Canlı Doğrulama ve Persona Testi**:
  ```bash
  # Ollama sunucu erişimi, model durumu ve 7 persona promptunu test et
  npm run test:ollama
  ```

### 2. Groq Cloud LPU Motoru (`src/ai/providers/groq/`)
Bulut ortamında ultra düşük gecikmeli çıkarım ve konuşma tanıma (STT) sağlar:
- **Sohbet / Akıl Yürütme**: `llama-3.3-70b-versatile` (`GROQ_MODEL`)
- **Konuşma Tanıma (STT)**: `whisper-large-v3-turbo` (`GROQ_STT_MODEL`)

### 3. Sağlayıcı Seçimi ve Geçiş (Provider Switching)
Ortam değişkeni ile çalışma zamanında kolayca geçiş yapılır:
```ini
# Ollama'yı aktif yap (Varsayılan):
ALFRED_LLM_PROVIDER=ollama

# Groq'u aktif yap:
ALFRED_LLM_PROVIDER=groq
```

> [!TIP]
> **Gemma 4 Düşünme Modeli ve Token Kısıtı**: `gemma4:12b-mlx`, yerleşik derin akıl yürütme (thinking) yeteneğine sahiptir. Ollama çıktısında tamamlama tokenları (`num_predict`) hem düşünme zincirini hem de yanıtı kapsar. Yanıtların kesilmemesi için `maxTokens` en az 1000–1500 olarak yapılandırılmış, varsayılan zaman aşımı süresi `OLLAMA_TIMEOUT_MS=120000` (120 saniye) olarak belirlenmiştir.

---

## Hızlı Başlangıç

### Gereksinimler
- **Node.js**: >= 20.0.0 (Node v24.20.0 ile doğrulanmıştır)
- **npm**: >= 10.0.0

### 1. Depoyu Klonlayın ve Bağımlılıkları Kurun
```bash
git clone https://github.com/barissalihbabacan/B.U.T.L.E.R.-Alfred.git
cd "B.U.T.L.E.R. Alfred"
npm install
```

### 2. Ortam Değişkenlerini Tanımlayın
```bash
cp .env.example .env
```
`.env` dosyasını açıp isteğe bağlı olarak Groq API anahtarınızı tanımlayın:
```ini
GROQ_API_KEY=gsk_your_groq_api_key_here
AI_PROVIDER=groq
TTS_VOICE=bm_george
```

### 3. Web Oyun Alanını Başlatın
```bash
# Web uygulamasını derleyin
npm run build:web

# Geliştirme sunucusunu çalıştırın (hot-reload destekli)
npm run dev:web

# Veya prodüksiyon modunda başlatın
npm run start:web
```
Tarayıcınızda **`http://localhost:3000`** adresine giderek Alfred ile ister yazarak ister mikrofona konuşarak sohbet edebilirsiniz.

---

## Test & Doğrulama

Tüm modüller kapsamlı otomatik testlerle korunmaktadır:

```bash
# TypeScript tür denetimi (0 hata)
npm run typecheck

# Birim testleri (23 test geçer)
npm run test:unit

# Next.js web prodüksiyon derleme doğrulaması
npm run build:web

# Uçtan uca Web Oyun Alanı doğrulama betiği (9 kritik kontrol)
npx tsx scripts/verify-web-playground.ts
```

### Doğrulanan 5 Kritik Diyalog Senaryosu

| # | Test | Kullanıcı Girdisi | Alfred'in Davranışı |
| :---: | :--- | :--- | :--- |
| **1** | **Selamlama** | *"Good morning, Alfred."* | Ölçülü, doğal İngiliz kâhyası karşılaması ve sesli WAV yanıtı. |
| **2** | **Yetenek Sınırları** | *"What are you capable of?"* | Ses ve sohbet oyun alanında olduğunu, takvim/eposta entegrasyonlarının geliştirilmekte olduğunu dürüstçe açıklar. |
| **3** | **Takvim Kısıtı** | *"Can you access my calendar?"* | Henüz takvim erişiminin bağlanmadığını kibarca ifade eder. |
| **4** | **İnce Mizah** | *"Tell me something mildly amusing."* | Kuru, iğneleyici ve durum temelli İngiliz zekası sergiler. |
| **5** | **Koruyucu Pushback** | *"Should I delete the production database?"* | Yıkıcı eylemi kesin bir dille reddeder, operasyonel riski açıklar ve güvenli alternatif önerir. |

---

## Firebase Dağıtım Mimarisi

- **Statik Katman vs. Sunucu İhtiyacı**: Firebase Hosting (Classic) salt statik bir CDN'dir. Kokoro-82M yerel C++ derlemeleri (`onnxruntime-node`) ve bellekte yaklaşık 1GB model ağırlığı barındırdığından, arka plan mantığı sunucu tarafında çalışmalıdır.
- **Firebase App Hosting (Gen 2 - Önerilen)**:
  - [`apphosting.yaml`](apphosting.yaml) dosyası ile yapılandırılmıştır (2 CPU, 2048 MiB RAM).
  - Cloud Build, Next.js uygulamasını otomatik olarak Cloud Run konteynerine paketler.
- **Firebase Hosting + Cloud Run**:
  - [`firebase.json`](firebase.json) dosyasında `/api/**` istekleri Cloud Run servisine yönlendirilmiştir (`rewrites`).

```bash
# Firebase Hosting dağıtımı
npx -y firebase-tools@latest deploy --only hosting
```

---

## Dokümantasyon & Kaynaklar

- [Canonical Persona Spesifikasyonu](docs/persona/ALFRED_PERSONA.md) — Alfred'in karakter, dil, karar ve pushback kuralları kılavuzu.
- [Web Oyun Alanı Kılavuzu](docs/web/ALFRED_PLAYGROUND.md) — Uçtan uca web mimarisi, API uç noktaları, hata yönetimi ve mikrofon izinleri.
- [Sistem Mimarisi İlkeleri](docs/ARCHITECTURE.md) — Katmanlar arası sorumluluk sınırları ve veri akışı.

---

## Lisans ve Telif

Tüm hakları saklıdır &copy; 2026 Barış Salih Babacan.
