import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// TODO: Replace the following with your app's Firebase project configuration
// See: https://firebase.google.com/docs/web/learn-more#config-object
const firebaseConfig = {
    apiKey: "AIzaSyD1BOEbdAU17kMm0XjNT8BlQXZk2mbZOF0",
    authDomain: "fake-jinxo-th.firebaseapp.com",
    databaseURL: "https://fake-jinxo-th-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "fake-jinxo-th",
    storageBucket: "fake-jinxo-th.firebasestorage.app",
    messagingSenderId: "297395038952",
    appId: "1:297395038952:web:b48104a4e9562e3265375d",
    measurementId: "G-7CEE2CQ3XB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
export const database = getDatabase(app);

export default app;
