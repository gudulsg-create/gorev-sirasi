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
