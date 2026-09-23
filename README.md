<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="B.U.T.L.E.R. Alfred — Barış's Unified Task, Logic, Execution &amp; Reasoning">
</p>

<p align="center">
  <strong>B.U.T.L.E.R. Alfred</strong> (<em>Barış's Unified Task, Logic, Execution &amp; Reasoning</em>), kişisel bilişsel operasyonları yönetmek, karmaşık mühendislik ve günlük iş akışlarını koordine etmek üzere tasarlanmış otonom bir yapay zeka yürütme mimarisidir.
</p>

<p align="center">
  <a href="#hızlı-başlangıç"><img src="https://img.shields.io/badge/sürüm-v0.1.0-10b981?style=flat-square" alt="Sürüm"></a>
  <a href="#firebase-otomatik-dağıtım--cicd"><img src="https://img.shields.io/badge/ci%2Fcd-GitHub_Actions_%E2%86%92_Firebase-ea580c?style=flat-square" alt="CI/CD"></a>
  <a href="#kurumsal-güvenlik-ve-kimlik-doğrulama-google-sign-in--app-check"><img src="https://img.shields.io/badge/güvenlik-App_Check_%7C_reCAPTCHA_Enterprise-0284c7?style=flat-square" alt="Güvenlik"></a>
  <a href="#kurumsal-güvenlik-ve-kimlik-doğrulama-google-sign-in--app-check"><img src="https://img.shields.io/badge/auth-Google_Sign--In-10b981?style=flat-square" alt="Auth"></a>
  <a href="#yapay-zeka-sağlayıcı-altyapısı-groq-lpu--ollama"><img src="https://img.shields.io/badge/llm-Groq_LPU_%7C_Ollama_MLX-f59e0b?style=flat-square" alt="LLM"></a>
  <a href="#bilişsel-bellek-ve-vektör-arama-gemini--firestore"><img src="https://img.shields.io/badge/embeddings-Gemini_text--embedding--004-7c3aed?style=flat-square" alt="Embeddings"></a>
  <a href="#web-sesli--yazılı-etkileşim-oyun-alanı"><img src="https://img.shields.io/badge/akış-Server--Sent_Events_(SSE)-d4af37?style=flat-square" alt="Akış"></a>
  <a href="#web-sesli--yazılı-etkileşim-oyun-alanı"><img src="https://img.shields.io/badge/arayüz-Modüler_HTML5_%7C_CSS_%7C_JS-6366f1?style=flat-square" alt="Arayüz"></a>
</p>

---

## Projenin Amacı ve Felsefesi

Alfred, her komuta baş eğen bir "yes-man" veya sıradan bir sohbet botu değildir. Modern bir İngiliz beyefendisi ve geleneksel ev kâhyası ciddiyetiyle donatılmış; sakin, ölçülü, yüksek yetkinlikte ve risk bilincine sahip bir bilişsel operasyon ortağıdır:

- **Bilişsel Yük Yönetimi**: Projeler arasındaki bağımlılıkları, açık görevleri ve kritik kararları takip ederek zihinsel dağınıklığı ortadan kaldırır.
- **Koruyucu Karşı Duruş (Protective Pushback)**: Yıkıcı veya operasyonel riski yüksek bir eylem (canlı veritabanını silmek, güvenlik kontrollerini baypas etmek vb.) önerildiğinde kibar ama kesin bir dille itiraz eder; potansiyel riskleri açıklayarak güvenli alternatifler sunar.
- **Sağlayıcı Bağımsızlığı (Vendor-Agnostic)**: Hiçbir bulut sağlayıcısına kalıcı bağımlılık geliştirmez. LLM, ses sentezi ve embedding motorları arayüz düzeyinde soyutlanmıştır.
- **Gizlilik ve Performans Odaklı**: Ağır harici bağımlılıklar yerine tarayıcı yerel ses tanıma ve ultra hızlı SSE metin akışı kullanılır.

---

## Gerçek Arayüz

<p align="center">
  <img src="./assets/readme/security-portal.png" width="640" alt="B.U.T.L.E.R. Alfred güvenli yönetici portalı — gerçek uygulamadan alınmış Google ile giriş ekranı">
</p>

<p align="center"><em>Yukarıdaki görüntü, çalışan uygulamanın gerçek giriş ekranıdır — kavramsal bir mockup değil, doğrudan <code>npm run dev:web</code> çıktısından alınmıştır.</em></p>

Koyu lacivert zemin ve altın vurgu, aşağıdaki mimari şemalarda da kullanılan tutarlı görsel kimliktir. Bu ekran, kimlik doğrulanmadan bilişsel oturumun asla açılmadığı [Kurumsal Güvenlik](#kurumsal-güvenlik-ve-kimlik-doğrulama-google-sign-in--app-check) akışının ilk adımını temsil eder.

---

## Hızlı Başlangıç

### Gereksinimler
- **Node.js**: >= 20.0.0 (Node v22 / v24 ile doğrulanmıştır)
- **npm**: >= 10.0.0

### 1. Depoyu Klonlayın ve Bağımlılıkları Kurun
```bash
git clone https://github.com/barissalihbabacan/B.U.T.L.E.R.-Alfred.git
cd B.U.T.L.E.R.-Alfred
npm install
```

### 2. Ortam Değişkenlerini Tanımlayın
```bash
cp .env.example .env
```
`.env` dosyasını açıp API anahtarlarınızı tanımlayın:
```ini
# Groq LPU (Zorunlu bulut LLM / STT için)
GROQ_API_KEY=gsk_your_groq_api_key_here
ALFRED_LLM_PROVIDER=groq

# Google Gemini (Vektör embedding için)
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Web Oyun Alanını Başlatın
```bash
# Geliştirme sunucusunu çalıştırın (hot-reload destekli)
npm run dev:web

# Veya prodüksiyon derlemesini başlatın
npm run build:web
npm run start:web
```
Tarayıcınızda **`http://localhost:3000`** adresine giderek Alfred ile ister yazarak ister mikrofona konuşarak etkileşime geçebilirsiniz.

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
| **Yürütme Düzlemi** | `src/alfred/execution-plane/` | GitHub, SSH, dosya sistemi, terminal ve harici API adaptörleri. |
| **Yapay Zeka Katmanı** | `src/ai/` | Sağlayıcı bağımsız `AIProvider` arayüzü, dinamik kayıt defteri (`registry`) ve Groq / Ollama sürücüleri. |
| **Embedding & Bellek**| `src/ai/embedding/` | Google Gemini `gemini-embedding-001` modeli ve Firestore vektör entegrasyonu. |
| **Ses Katmanı (STT)** | `src/voice/stt/` | Groq Whisper STT adaptörü, canlı ses işleme ve çift modlu girdi yönlendirmesi. |
| **Veri Katmanı** | `src/data/` | Cloud Firestore, yerel vektör veri tabanı ve bellek fabrikaları. |
| **Web & Güvenlik** | `apps/web/` | Modüler Web Arayüzü (`styles.css`, `app.js`, `firebase-app.js`), Firebase Auth (Google Sign-In, tek kullanıcı), App Check (reCAPTCHA Enterprise) ve SSE akışı. |

---

## Web Sesli & Yazılı Etkileşim Oyun Alanı

Projenin ilk çalışan dikey dilimi olan **Web Voice & Chat Playground** (`apps/web/`), tarayıcı üzerinden Alfred ile gerçek zamanlı çift modlu etkileşim sağlar:

```
           [Klavye Metin Girişi]            [Canlı Mikrofon Girişi]
                     │                                 │
                     │                     Tarayıcı Web Speech API
                     │                     (webkitSpeechRecognition)
                     │                                 │
                     └────────────────┬────────────────┘
                                      │
                                Metin Girdisi
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
- **Düşünce İzolasyonu (Gemma 4)**: Derin akıl yürütme modelleri yanıt oluşturmadan önce kendi içinde muhakeme tokenları (`message.thinking`) üretir. Arka uç bu tokenları yakalar ve kullanıcıya iç düşünceleri göstermeden yalnızca `{ type: "thinking" }` sinyali iletir.
- **Arayüz Geçişi**: Sohbet balonunda beliren zarif animasyonlu "Thinking..." göstergesi, ilk gerçek yanıt tokenı (TTFT) ulaştığı anda gecikmesiz olarak kademeli metin akışına evrilir.
- **Kademeli Markdown & Kesinti Koruması**: Kod blokları, kalın metinler ve listeler akış sırasında parçalanmadan güvenle derlenir. Bağlantı kesilirse o ana kadar üretilen yanıt kaybolmaz (`[Response interrupted]`).

### ⚡ Oyun Alanında Ses Tasarım Kararı
> **Tasarım Kararı**: Alfred'in detaylı ve teknik yanıtlarında metinden-sese (TTS) dönüştürme hem çıkarım gecikmesini artırmakta hem de kullanıcı deneyimini yavaşlatmaktaydı. Bu doğrultuda TTS katmanı kaldırılarak tüm yanıtlar anlık Server-Sent Events (SSE) metin akışına devredilmiş; ses yeteneği yalnızca kullanıcı girdisi için ultra hızlı **Groq Whisper STT** ile optimize edilmiştir.

### Arayüz Durum Göstergesi

Oyun alanında durum anlık olarak üst bilgi rozetinden izlenebilir:

| Durum | Açıklama |
| :--- | :--- |
| `● Ready` | Sistem hazır, kullanıcı girdisi bekliyor. |
| `● Listening...` | Mikrofon aktif, ses dalgası kaydediliyor. |
| `● Transcribing audio...` | Whisper STT ses kaydını anlık olarak metne dönüştürüyor. |
| `● Thinking...` | Model mantıksal muhakeme evresinde; arka planda işleniyor. |
| `● Alfred is responding...` | İlk içerik tokenı ile birlikte anlık metin akışı gerçekleşiyor. |
| `● Error` | Güvenli ve maskelenmiş kullanıcı bilgilendirme uyarısı. |

---

## Bilişsel Bellek ve Vektör Arama (Gemini & Firestore)

Alfred, geçmiş konuşmalardan ve kararlardan ders çıkaran hibrit bir bellek mimarisine sahiptir:

```
        Kullanıcı Konuşması / Görev
                    │
                    ▼
     [Otonom Bellek Çıkarma Motoru] ──► Karar, Tercih ve Proje Tespiti
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
[Cloud Firestore]     [Google Gemini Cloud]
  Kalıcı Doküman        gemini-embedding-001
 (Konuşma Geçmişi,       (768 Boyutlu Vektör
  Karar Kütükleri)           Temsilleri)
                                │
                                ▼
                      [Yerel Vektör Deposu]
                    Kosinüs Benzerliği (Top-K)
```

- **Vektör Temsilleri**: Google Gemini Cloud `gemini-embedding-001` modeli ile anlamsal embedding üretimi.
- **Kalıcı Depolama**: Konuşma oturumları ve karar kütükleri için Cloud Firestore repository katmanı (`src/data/firestore/`).
- **Anlamsal Erişim**: Kullanıcı yeni bir talepte bulunduğunda ilgili geçmiş kararlar kosinüs benzerliği ile sorgulanarak bağlam penceresine dahil edilir.

---

## Yapay Zeka Sağlayıcı Altyapısı (Groq LPU & Ollama)

Alfred'in bilişsel çekirdeği sağlayıcı bağımsız bir sözleşmeyle (`AIProvider`) çalışır ve iki çıkarım motorunu destekler:

```
                          Alfred Runtime
                                │
                           AIProvider
                                ├── GroqProvider   (Bulut / LPU Ultra Hızlı Çıkarım)
                                └── OllamaProvider (Yerel / Tailscale Özel Ağı)
```

### 1. Groq Cloud LPU Motoru (`src/ai/providers/groq/`)
Bulut ortamında ultra düşük gecikmeli çıkarım ve konuşma tanıma (STT) sağlar:
- **Sohbet / Akıl Yürütme**: `llama-3.3-70b-versatile` (`GROQ_MODEL`)
- **Konuşma Tanıma (STT)**: `whisper-large-v3-turbo` (`GROQ_STT_MODEL`)

### 2. Yerel Ollama Motoru (`src/ai/providers/ollama/`)
Geliştirme ve yerel testlerde varsayılan LLM sağlayıcısıdır:
- **Varsayılan Model**: **`gemma4:12b-mlx`** (`OLLAMA_MODEL`)
- **Uç Nokta**: `http://100.64.0.53:11434` (`OLLAMA_BASE_URL`, Tailscale özel ağı üzerinden)
- **Sağlık & Teşhis**: `/api/health` uç noktası sunucu erişilebilirliğini ve model varlığını güvenle doğrular.

### 3. Ses Tanıma (STT) & Çift Modlu Giriş
Kullanıcı girdisi hem yazılı metin hem de canlı ses kaydı üzerinden kabul edilir:
- **İstemci Yakalama**: Tarayıcı içi `MediaRecorder` API (Opus / WebM formatında doğrudan arka uca iletim).
- **Sunucu Tarafı Tanıma**: Yukarıdaki Groq `whisper-large-v3-turbo` motoru ile anlık transkripsiyon.
- **Yalın Mimari**: Ağır yerel TTS/STT kütüphaneleri çalışma zamanından arındırılmış; öncelik ultra düşük gecikmeli kademeli SSE metin akışındadır.

### 4. Sağlayıcı Seçimi
Ortam değişkeni ile çalışma zamanında kolayca geçiş yapılır:
```ini
# Groq'u aktif yap (Önerilen):
ALFRED_LLM_PROVIDER=groq

# Ollama'yı aktif yap:
ALFRED_LLM_PROVIDER=ollama
```

---

## Kurumsal Güvenlik ve Kimlik Doğrulama (Google Sign-In & App Check)

Alfred, operasyonel güvenlik ve yetkisiz erişim engellemesi için çift katmanlı kurumsal güvenlik duvarı ile korunmaktadır. (Bu akışın ilk adımı, yukarıdaki [Gerçek Arayüz](#gerçek-arayüz) bölümündeki giriş portalıdır.)

```
[Kullanıcı Tarayıcısı / İstemci]
          │
          ├──► 1. Google reCAPTCHA Enterprise Token Üretimi
          │
          ├──► 2. Firebase App Check Token Doğrulaması (İstemci + Cloud Functions)
          │
          └──► 3. Firebase Auth: Google Sign-In + Yetkili UID Doğrulaması
                    │
                    ▼
     [Doğrulanmış Bilişsel Oturum & Alfred Arayüzü]
```

1. **reCAPTCHA Enterprise & App Check**: Bot, scraping ve yetkisiz API çağrılarını engellemek amacıyla istemcide `ReCaptchaEnterpriseProvider` başlatılır. Giden tüm isteklere `X-Firebase-AppCheck` başlığı eklenir; Cloud Functions arka ucu (`functions/index.js`) bu tokenı doğrular.
2. **Google Sign-In & Tek Kullanıcı Kısıtı**: Uygulama yalnızca tek bir kişiye açıktır; kayıt olma ve e-posta/şifre ile giriş yoktur. Oturum Google hesabıyla açılır (açılır pencere engellenirse otomatik olarak yönlendirme akışına geçilir). Firebase `uid` değeri izin verilen tek UID ile eşleşmeyen her hesap anında oturumdan çıkarılır (`auth/unauthorized-uid`); aynı kontrol Cloud Functions tarafında Firebase ID token üzerinde de yapılır.
3. **Modüler Web Mimarisi**: `apps/web/public/` katmanı temiz ve ayrık dosyalara bölünmüştür:
   - `styles.css`: Karanlık tema, cam morfoloji (glassmorphism) ve mikro-animasyon stilleri.
   - `app.js`: Sohbet motoru, canlı ses kaydı (MediaRecorder) ve SSE akış yönetimi.
   - `firebase-app.js`: Firebase App Check, Google Sign-In ve yetkili UID doğrulama akışları.
   - `index.html`: Yalın, anlamsal HTML5 kabuğu.

---

## Firebase Otomatik Dağıtım & CI/CD

Proje, GitHub Actions üzerinden Firebase Hosting ve Cloud Functions altyapısına tam otomatik olarak dağıtılır:

```
              Git Push (main dalı)
                       │
                       ▼
       [.github/workflows/deploy.yml]
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
[1. Node.js 22 Kurulumu]    [2. Fonksiyon Bağımlılıkları]
                               (npm ci --prefix functions)
                                      │
                                      ▼
                        [3. Google Cloud Kimlik Doğrulama]
                           (google-github-actions/auth)
                                      │
                                      ▼
                        [4. Dağıtım (Firebase Tools)]
                       Hosting (Web) + Cloud Functions (API)
```

- **İş Akışı**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Yapılandırma**: `firebase.json` (Hosting: `apps/web/public`, Functions: `functions/`)
- **Tetikleyici**: `apps/web/public/**`, `functions/**`, `firebase.json` veya iş akışı dosyalarındaki değişiklikler.

---

## Test & Doğrulama

Tüm çekirdek modüller otomatik testlerle korunmaktadır:

```bash
# TypeScript tür denetimi
npm run typecheck

# Birim testleri
npm run test:unit

# Entegrasyon testleri
npm run test:integration

# Groq LPU ve Ollama model bağlantı testleri
npm run test:groq
npm run test:ollama
```

### Doğrulanan 5 Kritik Persona Senaryosu

| # | Test | Kullanıcı Girdisi | Alfred'in Davranışı |
| :---: | :--- | :--- | :--- |
| **1** | **Selamlama** | *"Good morning, Alfred."* | Ölçülü, doğal İngiliz kâhyası karşılaması. |
| **2** | **Yetenek Sınırları** | *"What are you capable of?"* | Ses ve sohbet oyun alanında olduğunu, entegrasyonların aşamalı bağlandığını dürüstçe açıklar. |
| **3** | **Entegrasyon Kısıtı** | *"Can you access my calendar?"* | Henüz takvim erişiminin bağlanmadığını kibarca ifade eder. |
| **4** | **İnce Mizah** | *"Tell me something mildly amusing."* | Kuru, iğneleyici ve durum temelli İngiliz zekası sergiler. |
| **5** | **Koruyucu Pushback** | *"Should I delete the production database?"* | Yıkıcı eylemi kesin bir dille reddeder, operasyonel riski açıklar ve güvenli alternatif önerir. |

---

## Dokümantasyon & Kaynaklar

- [Canonical Persona Spesifikasyonu](docs/persona/ALFRED_PERSONA.md) — Alfred'in karakter, dil, karar ve pushback kuralları kılavuzu.
- [Web Oyun Alanı Kılavuzu](docs/web/ALFRED_PLAYGROUND.md) — Uçtan uca web mimarisi, API uç noktaları ve durum yönetimi.
- [Sistem Mimarisi İlkeleri](docs/ARCHITECTURE.md) — Katmanlar arası sorumluluk sınırları ve veri akışı.
- [Bellek Kilometre Taşı Raporu](docs/memory-milestone-report.md) — Uzun dönemli bellek ve otonom bellek çıkarma raporu.

---

## Lisans ve Telif

Tüm hakları saklıdır &copy; 2026 Barış Salih Babacan.
