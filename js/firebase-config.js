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

export const firebaseConfig = null;

// Aynı Firebase projesinde birden fazla ekip/klinik tutmak isterseniz her biri için farklı bir ad verin.
export const teamId = 'ekip';
