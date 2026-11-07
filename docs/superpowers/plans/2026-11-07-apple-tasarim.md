# Apple tarzı sade tasarım (3.0.0) — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Görev Sırası'nı iOS'un kendi uygulamaları (Ayarlar, Anımsatıcılar) gibi sade, gruplu listeli, alttan açılan sayfalı ve yumuşak animasyonlu hale getirmek; hiçbir özellik kaybolmadan.

**Architecture:** Saf HTML/CSS/ES modülleri korunur (derleme yok, bağımlılık yok). Saf biçimlendirme mantığı yeni `js/format.js`'e (testli), simgeler `js/icons.js`'e taşınır. `css/style.css` yeni tasarım sistemiyle baştan yazılır. `js/app.js` görünümleri yeni bileşenlerle (grup, satır, sayfa, eylem sayfası) yeniden kurulur; arka uç ve `rotation.js` değişmez.

**Tech Stack:** Vanilla JS (ES modules), CSS custom properties, `<dialog>`, node:test.

**Spec:** Sohbette onaylanan 3 ekranlı taslak (ana ekran, "Kime verilsin?" sayfası, Görevlerim) + aşağıdaki kararlar.

## Global Constraints
- Sürüm `3.0.0` (APP_VERSION ve package.json), sw.js önbellek adı `gorev-sirasi-v5`, SHELL'e yeni dosyalar eklenir.
- Gerçek isim yok; görev notlarında hasta bilgisi uyarısı korunur.
- Emoji arayüz iskeletinde (başlık, düğme, sekme) kullanılmaz; içerikte (tepkiler, eski duyuru metinleri) kalır.
- Temalar (`sl`, `kb`, `klasik`) vurgu rengi olarak sürer; koyu mod `prefers-color-scheme` ile.
- `prefers-reduced-motion`: tüm hareketler kapanır, durum değişimleri anında olur.
- Mevcut yetki kuralları (isAdmin, canPassOn, canToggleDone, canManage) aynen korunur.

## Kararlar (benim seçimlerim)
- Alt çubuk 4 sekme: Görev ver, Görevlerim, Geçmiş, Ekip. Ayarlar sağ üstteki profil fotoğrafından açılır (iOS hesap düğmesi gibi), "Bitti" ile kapanır.
- Renkli üst bar kalkar; her sekmede büyük başlık (34px). Kaydırınca üstte küçük başlıklı yarı saydam çubuk belirir.
- "Sıradakiler" tablosu ana ekrandan kalkar; sıradaki kişi görev verme sayfasında görünür.
- Görev verme: türe dokun → alttan sayfa → kıdem satırında "Ver". Son gün ve Not "Seçenekler" altında açılır kapanır.
- Görevlerim/Geçmiş satırı: solda tamamlama yuvarlağı, sağda ⋯ → eylem sayfası (Aktar, Tepki ver, Profil, İptal).
- Ekip: satırlar sade; başasistan satıra dokununca kişi düzenleme sayfası (fotoğraf, ad, kıdem, sıra yukarı/aşağı, izinli anahtarı, PIN ata, tarihli izin, çıkar).
- Sayfa animasyonu: translateY(100%)→0, 420ms `cubic-bezier(0.32,0.72,0,1)`; kapanış 260ms; tutamaktan aşağı çekince kapanır.

## Review Focus
1. Sayfa kapanırken (animasyon sürerken) yeni sayfa açılması (ör. "Sonrakine aktar" → sonuç) — yeni sayfa açık kalmalı, kapanma iptal olmalı.
2. Escape/geri tuşu ile kapatma — animasyonlu kapanmalı, `close` dinleyicileri (duyurular) yine çalışmalı.
3. Uzun isimler ve 5+ görev türü — satırlar taşmamalı, Geçmiş filtresi kaydırılabilir olmalı.
4. Giriş yapılmamış ve ekip boş (ilk kurulum) durumları — Ekip ve Ayarlar erişilebilir kalmalı.
5. Tamamlama yuvarlağına art arda hızlı dokunma — tek işlem yapılmalı.

---

### Task 1: Saf biçimlendirme ve simge eşlemesi (TDD)
**Files:** Create `js/format.js`, `tests/format.test.js`; Modify `js/swipe.js`, `tests/swipe.test.js`.
**Produces:**
- `dueInfo(dueDate: string|null, today: string, status: string) -> null | { text: string, tone: 'late'|'today'|'soon'|'normal' }` — aktif: dün → "Son gün dündü" (late), n gün önce → "n gün gecikti" (late), bugün → "Son gün bugün" (today), yarın → "Son gün yarın" (soon), aksi → "Son gün 9 Kas" (normal); aktif değilse her zaman normal "Son gün 9 Kas".
- `dayGroupLabel(ms: number, nowMs: number) -> string` — "Bugün", "Dün", "5 Kas", başka yıl "5 Kas 2025".
- `typeIcon(name: string) -> 'microscope'|'flask'|'book'|'clipboard'` — /patoloji/i, /örneklem|orneklem/i, /kitap/i, diğer.
- `TAB_ORDER = ['give','mine','history','team']`.
- [ ] Testleri yaz (yukarıdaki her dal için bir assert), çalıştır → FAIL.
- [ ] Uygula, `npm test` → hepsi PASS.

### Task 2: Tasarım sistemi (CSS) ve iskelet (HTML)
**Files:** Rewrite `css/style.css`; Modify `index.html`; Create `js/icons.js` (`icon(name, size=22) -> SVGElement`, stroke 1.9, `currentColor`).
- Token'lar: `--bg #f2f2f7 / #000`, `--surface #fff / #1c1c1e`, `--surface-2 #f2f2f7 / #2c2c2e`, `--sep rgba(60,60,67,.18) / rgba(84,84,88,.55)`, `--text`, `--text-2 rgba(60,60,67,.6) / rgba(235,235,245,.6)`, `--text-3 #c7c7cc / #48484a`, `--red #ff3b30/#ff453a`, `--green #34c759/#30d158`, `--orange #ff9500/#ff9f0a`, `--accent`, `--accent-on`, `--tile-bg`, `--tile-fg`.
- Tema vurguları: sl açık accent `#0b2357`, tile navy+`#ffd100`; sl koyu accent `#ffd100`; kb `#c8102e` / koyu `#ff4d63`; klasik `#0a6ed1` / koyu `#0a84ff`.
- Bileşenler: `.large-title`, `.nav-bar` (yapışkan, kaydırınca `.scrolled`), `.group-title`, `.group`, `.cell` (+`.cell-icon`, `.cell-body`, `.cell-title`, `.cell-sub`, `.cell-detail`, `.chev`), `.pill-btn`, `.check` (yuvarlak), `.switch-ios`, `.segmented`, `dialog.sheet` (+`.grabber`, `.sheet-head`), `dialog.alert`, `dialog.action-sheet`, `.hud` (toast), `.tabbar`.
- [ ] Yerel test sunucusunda boş sayfa hatasız açılıyor.

### Task 3: Sayfa (sheet) altyapısı
**Files:** Modify `js/app.js` (`openDialog`, yeni `closeDlg()`, `openSheet`, `actionSheet(title, items)`, `askConfirm` iOS uyarı stili, sürükle-kapat).
- `closeDlg()`: `.closing` ekler, 260ms sonra `dlg.close()`; bu sırada `openDialog` çağrılırsa zamanlayıcı iptal, sınıf kalkar.
- Tüm `dlg.close()` çağrıları `closeDlg()` olur; `cancel` olayı yakalanıp `closeDlg()`.
- `actionSheet(title, items: {label, icon?, danger?, onSelect}[]) -> void`.
- [ ] Elle: aç, kapat, Escape, aşağı çek, kapanırken yeniden aç.

### Task 4: Görev ver akışı + ana ekran
**Files:** Modify `js/app.js` (`giveView`, `chooseSeniority`, `showResult`, `announcementCard`, `monthCard`, `upcomingRecurring`, `installHint`).
- [ ] Elle: türe dokun → sayfa → Ver → sonuç animasyonu → Tamam / Sonrakine aktar / Geri al.

### Task 5: Görevlerim, Geçmiş, satır eylemleri
**Files:** Modify `js/app.js` (`assignmentItem` → `taskRow(a, opts)`, `taskActions(a)`, `mineView`, `historyView`, tamamlama animasyonu, çift dokunma kilidi).
- [ ] Elle: yuvarlağa dokun → dolma animasyonu → Tamamlanan bölümüne geçer; ⋯ → Aktar/İptal/Tepki.

### Task 6: Ekip, Ayarlar, Giriş, profil, duyurular
**Files:** Modify `js/app.js` (`teamView`, `personRow`, `editPerson`, `settingsView`, `themeBlock`, `notifBlock`, `recurringBlock`, `editableList`, `loginView`, `openLogin`, `openAccount`, `openProfile`, `renderAnnouncements`, `openLeaderboard`).
- [ ] Elle: başasistan ve normal kullanıcı olarak her ekran; çıkış/giriş; ilk kurulum.

### Task 7: Doğrulama ve yayın
- [ ] `npm test` hepsi PASS; telefon (375px) açık/koyu, 3 tema; geniş ekran; konsol hatasız.
- [ ] Sürüm 3.0.0, sw v5, commit (Türkçe) + push; canlı sitede `APP_VERSION = '3.0.0'`.
