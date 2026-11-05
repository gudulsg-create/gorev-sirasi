// Ortak kullanım için Firebase ayarları.
//
// Boş bırakılırsa (null) uygulama "yerel mod"da çalışır: veriler yalnızca o cihazda kalır.
// Ekipçe ortak sıra için README'deki "Firebase kurulumu" adımlarını izleyin ve
// Firebase konsolunun verdiği değerleri aşağıya yapıştırın:
//
// export const firebaseConfig = {
//   apiKey: '...',
//   authDomain: '....firebaseapp.com',
//   projectId: '...',
//   storageBucket: '....appspot.com',
//   messagingSenderId: '...',
//   appId: '...',
// };

export const firebaseConfig = {
  apiKey: 'AIzaSyA2h0FnjEpgavGIEHWGMmhywW6h6sQgwjU',
  authDomain: 'serhat-f88f7.firebaseapp.com',
  projectId: 'serhat-f88f7',
  storageBucket: 'serhat-f88f7.firebasestorage.app',
  messagingSenderId: '475616495816',
  appId: '1:475616495816:web:9b18395c7c97ab79b3fdfd',
};

// Aynı Firebase projesinde birden fazla ekip/klinik tutmak isterseniz her biri için farklı bir ad verin.
export const teamId = 'ekip';

// ---------------- Bildirimler (isteğe bağlı) ----------------
// İkisi de doluysa uygulamada "Bildirimleri aç" düğmesi görünür. Kurulum: README → "Bildirimler".
// Firebase konsolu → Proje ayarları → Cloud Messaging → Web Push sertifikaları → "Anahtar çifti" (genel anahtar):
export const vapidKey = 'BLjLybNptc_Osg7Vi6uwQbSUnDNVYC2fOk8_ZKLmUQ3eIJjh0SpJyav5yxxunvMOMS4z_ojs4-bKorsUoKHVK4o';
// Cloudflare Worker adresi, ör. https://gorev-sirasi-bildirim.KULLANICI.workers.dev
export const notifyUrl = 'https://gorev-sirasi-bildirim.gudul-sg.workers.dev';
