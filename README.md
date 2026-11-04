# Görev Sırası

Asistanlar arasında kıdeme göre, **sırayla ve adil** görev dağıtan bir web uygulaması.

Üst kıdem bir görev türüne (ör. *Patoloji yazmak*) dokunur, hangi kıdeme vereceğini seçer. Uygulama görevi o kıdemde **sırası gelen kişiye** atar. Başka biri aynı görevi aynı kıdeme verdiğinde görev bir sonraki kişiye gider. Sıra herkes için ortaktır ve Firebase üzerinden anında güncellenir.

![Ekran görüntüsü](docs/ekran.png)

## Nasıl çalışır

- **Ayrı sıralar:** Her *görev türü + kıdem* çiftinin kendi sırası vardır. Örneğin 5. kıdemin patoloji sırası ile örneklem sırası birbirinden bağımsızdır.
- **Görev yalnızca aşağı verilir:** "Ben kimim?" bölümünden kendini seçersin. Uygulama yalnızca senin altındaki kıdemleri açar. Hocalar "Listede yokum" seçeneğiyle her kıdeme görev verebilir.
- **İzinli:** Ekip sekmesinde "İzin" işaretlenen kişi, işaret kaldırılana kadar bütün sıralarda atlanır.
- **Sonrakine aktar:** Görevi alan kişi müsait değilse görev sıradaki kişiye geçer. Sıra o kişiden devam eder.
- **Geri al:** Yanlışlıkla verilen görev iptal edilir. Bu sırada arada başka görev verilmediyse sıra yine aynı kişide kalır.
- **Geçmiş:** Kim, kime, ne zaman, hangi görevi verdi; tamamlandı veya iptal durumu.
- **Sıra düzeni:** Ekip sekmesindeki ↑ ↓ düğmeleriyle değiştirilir. Yeni eklenen kişi kendi kıdeminin sırasının sonuna girer.
- **Yeni dönem:** Ayarlar sekmesinde "Herkesi bir üst kıdeme geçir" (5. kıdem → 4. kıdem …). Başasistan ekipten çıkar.
- Görev türleri ve kıdem adları Ayarlar sekmesinden değiştirilebilir. Kıdemler en kıdemliden en yeniye doğru sıralanır.
- Aynı anda iki kişi görev verirse Firestore işlemi (transaction) sayesinde ikisi aynı kişiye düşmez.

## Firebase kurulumu (ekipçe ortak kullanım, ~10 dakika, ücretsiz)

Firebase ayarlanmazsa uygulama **yerel mod**da çalışır: veriler yalnızca o cihazda kalır.

1. <https://console.firebase.google.com> adresinde **Proje ekle** deyin (Google Analytics gerekmez).
2. **Build → Authentication → Get started → Sign-in method** altında **Anonymous** (Anonim) yöntemini açın.
3. **Build → Firestore Database → Create database** ile bir veritabanı oluşturun (konum: `eur3` veya size yakın bir bölge, *production mode*).
4. Firestore'un **Rules** sekmesine bu depodaki `firestore.rules` dosyasının içeriğini yapıştırıp **Publish** deyin.
5. **Proje ayarları (⚙️) → Genel → Uygulamalarınız → Web (`</>`)** ile bir web uygulaması ekleyin. Size verilen `firebaseConfig` değerlerini `js/firebase-config.js` dosyasına yapıştırın.
6. **Authentication → Settings → Authorized domains** listesine GitHub Pages adresinizi ekleyin (ör. `kullaniciadi.github.io`).
7. Değişikliği GitHub'a gönderin. Başlıkta **● Ortak (canlı)** yazısını görüyorsanız bağlantı tamamdır.

> `firebaseConfig` değerleri gizli değildir; Firebase bunların sayfada görünmesini öngörür. Erişimi güvenlik kuralları belirler.

### Ekibi ilk kez yükleme

Ayarlar → **İçe aktar** ile ekip dosyasını (JSON) bir kez yükleyin. Firebase bağlıysa ekip herkese görünür. Ekip, Ekip sekmesinden elle de girilebilir.

## Giriş, PIN ve yetkiler

- Herkes adını seçip **PIN**'iyle giriş yapar. Giriş yapan kişi o cihazda sabittir; başka biri olarak işlem yapılamaz.
- **İlk kurulum:** Ekip yüklendikten sonra **başasistan** adını seçip kendine PIN belirler. Diğerlerinin PIN'lerini **Ekip** sekmesindeki 🔑 düğmesiyle o atar ve kişiye kendisi iletir.
- Başasistan bir kişinin PIN'ini yeniden atarsa o kişinin açık oturumları kapanır. Her kullanıcı kendi PIN'ini **Ayarlar → Hesabım** bölümünden değiştirebilir.
- Yetkiler:
  - Görev verme: giriş yapan herkes, yalnızca alt kıdemlere.
  - Görev **iptali / geri alma**: yalnızca başasistan.
  - Sonrakine aktarma: görevi veren kişi veya başasistan.
  - Tamamlandı işareti: görevi alan, veren veya başasistan.
  - Ekip, izin, sıra, görev türleri, kıdemler, içe aktarma: yalnızca başasistan.
- Başasistan = **Kıdemler** listesinin en üstündeki kıdem. "Yeni dönem" ile kıdemler kayınca yeni başasistan bu yetkileri kendi PIN'iyle devralır.
- 5 yanlış PIN denemesinden sonra giriş 30 saniye kilitlenir.

> **Not:** PIN kontrolü tarayıcıda yapılır. Günlük kullanımda başkası adına işlem yapmayı engeller, ama tarayıcı geliştirici araçlarını bilen biri bu kontrolü aşabilir. Sunucu tarafında zorunlu kimlik doğrulaması gerekirse "Google ile giriş" eklenebilir.

## Güvenlik ve gizlilik

- Uygulama adresini bilen herkes görev verebilir ve listeyi görebilir. Adresi yalnızca ekiple paylaşın.
- **Not alanına hasta adı, TC kimlik no gibi kişisel sağlık verisi yazmayın (KVKK).** Not yerine protokol numarası gibi kurum içi bir kısaltma kullanın.
- Ekip isimlerini herkese açık bir GitHub deposuna koymak istemiyorsanız ekip dosyasını depoya eklemeyin; yalnızca içe aktarın.

## GitHub Pages'te yayınlama

1. Depoyu GitHub'a gönderin.
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`** seçin.
3. Uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde açılır. Telefonda tarayıcı menüsünden **Ana ekrana ekle** derseniz uygulama gibi açılır.

## Yerelde çalıştırma ve testler

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # sıra mantığının birim testleri (Node 18+)
```

## Proje yapısı

```
index.html              Sayfa iskeleti
css/style.css           Stiller (mobil öncelikli, koyu tema)
js/rotation.js          Sıra mantığı (saf fonksiyonlar, testli)
js/backend.js           Veri katmanı: yerel (localStorage) veya Firebase Firestore
js/firebase-config.js   Firebase ayarları (boşsa yerel mod)
js/app.js               Arayüz
firestore.rules         Firestore güvenlik kuralları
tests/                  Birim testleri
```
