// Firebase 웹 앱 설정.
// Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → "SDK 설정 및 구성"의 firebaseConfig 내용을 붙여 넣는다.
// null 이면 온라인 메뉴가 "서버 준비 중"으로 표시되고, 혼자 하기는 그대로 동작한다.
// (웹페이지에 공개되는 값. 보안은 firebase-rules.json 규칙이 담당)
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAUFHGOHP6LLnOvhsyGAx2sqFCsc_E-aWk',
  authDomain: 'gacha-pig.firebaseapp.com',
  databaseURL: 'https://gacha-pig-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'gacha-pig',
  storageBucket: 'gacha-pig.firebasestorage.app',
  messagingSenderId: '824574782629',
  appId: '1:824574782629:web:e0f13892fb3d0f0db5314c',
};

export const ONLINE = {
  maxConcurrent: 90,   // 동시 접속 상한 (Firebase 무료 한도 100)
  maxPlayers: 4,
};
