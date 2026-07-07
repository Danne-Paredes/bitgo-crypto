// Import the functions you need from the SDKs you need
import { initializeApp, } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence,  } from 'firebase/auth'
import { getFirestore, collection, getDocs } from 'firebase/firestore'
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAx5VHQHmoFxiDdGZomUbB4UUlpV7aKEog",
  authDomain: "kv-crypto-app.firebaseapp.com",
  projectId: "kv-crypto-app",
  storageBucket: "kv-crypto-app.firebasestorage.app",
  messagingSenderId: "1088070671005",
  appId: "1:1088070671005:web:9310e1f776d33baf72d274",
  measurementId: "G-50CLK118PD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Error setting persistence:", error);
});

export const ALLOWED_DOMAINS = ['knighted.com', 'knightedvegas.com'];

export const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  'prompt': 'select_account'
});

export const db = getFirestore(app)

// Define a generic function to get data from any collection
export const getDataFromCollection = async <T>(collectionName: string): Promise<T[]> => {
  const db = getFirestore();
  const collectionRef = collection(db, collectionName);
  const querySnapshot = await getDocs(collectionRef);

  // Map the documents to include the document ID
  const documents = querySnapshot.docs.map((doc:any) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];

  return documents;
};