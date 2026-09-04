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
                                POST /api/chat
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
          Alfred Persona Yönergesi            Groq LPU Çıkarımı
       (docs/persona/ALFRED_PERSONA)       (llama-3.3-70b-versatile)
                      │                               │
                      └───────────────┬───────────────┘
                                      │
                                Alfred Yanıtı
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │     Hızlı & Zengin Arayüz     │
                      │  - Anlık Markdown render      │
                      │  - Kalın (**bold**), kod blok │
                      │  - Sıfır ses sentez gecikmesi │
                      └───────────────────────────────┘
```

### ⚡ Oyun Alanında Ses Sentezi (Kokoro-82M) Tasarım Kararı
> **Tasarım Kararı**: Alfred'in detaylı, teknik ve uzun yanıtlarında metinden-sese (TTS) dönüştürme hem çıkarım gecikmesini artırmakta hem de uzun konuşmaları dinlemeyi sıkıcı ve verimsiz hale getirmekteydi. Bu nedenle Web Oyun Alanında (`apps/web/`) otomatik Kokoro seslendirmesi doğrudan kaldırılmıştır. Arayüz; anlık, akıcı ve güvenli Markdown (`**kalın**`, `*italik*`, kod blokları) destekli hızlı metin okuma deneyimine odaklanmıştır. Kokoro-82M ses motoru mimari çekirdekte (`src/voice/providers/kokoro/`) çevrimdışı CLI araçları ve toplu sentezleme testleri için korunmaktadır.

### Arayüz Durum Göstergesi

Oyun alanında durum anlık olarak üst bilgi rozetinden izlenebilir:
- `● Ready`: Sistem hazır, kullanıcı girdisi bekliyor.
- `● Listening...`: Mikrofon aktif, ses dalgası kaydediliyor.
- `● Transcribing...`: Whisper STT ses kaydını metne dönüştürüyor.
- `● Alfred is reasoning...`: Groq LPU ve Alfred persona modeli düşünüyor.
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

---

## Yapay Zeka Sağlayıcı Altyapısı (Groq LPU)

Alfred'in bilişsel çekirdeği sağlayıcı bağımsız bir sözleşmeyle (`AIProvider`) çalışır:

- **Varsayılan Sağlayıcı**: **Groq Cloud** (`src/ai/providers/groq/`) — LPU donanımı sayesinde ultra düşük gecikme:
  - Sohbet / Akıl Yürütme: `llama-3.3-70b-versatile` (`GROQ_MODEL`)
  - Konuşma Tanıma (STT): `whisper-large-v3-turbo` (`GROQ_STT_MODEL`)
- **Çevrimdışı / Anahtarsız Yedek (Fallback)**: `GROQ_API_KEY` ortamda bulunmadığında, sistem çökmek yerine deterministik persona yanıt motoruna geçerek yerel arayüzün ve ses sentezinin test edilmesine olanak tanır.

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
