import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyD60B0MMhoeSuw9O3TE9EZmggfEczsmTeI",
    authDomain: "ummacu-88a5c.firebaseapp.com",
    projectId: "ummacu-88a5c",
    storageBucket: "ummacu-88a5c.firebasestorage.app",
    messagingSenderId: "458798824275",
    appId: "1:458798824275:web:a1d23fefb0af917d057fa6",
    measurementId: "G-P2BBTQYQWK"
};

const app = initializeApp(firebaseConfig);

try {
    getAnalytics(app);
} catch (_) {
    // Analytics can fail on localhost/file mode.
}

const db = getFirestore(app);
const auth = getAuth(app);
const rtdb = getDatabase(app);
const storage = getStorage(app);

export { app, db, auth, rtdb, storage };
