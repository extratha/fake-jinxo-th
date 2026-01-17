
/**
 * NOTE FOR USER: Replace these mock functions with actual Firebase Realtime Database logic.
 * 
 * import { initializeApp } from "firebase/app";
 * import { getDatabase, ref, set, onValue, update } from "firebase/database";
 * 
 * const firebaseConfig = { ... };
 * const app = initializeApp(firebaseConfig);
 * const db = getDatabase(app);
 */

export const mockDb = {
  // These are placeholders to simulate Firebase behavior
  saveRoom: async (room: any) => {
    console.log('Firebase: Saving room', room);
    localStorage.setItem(`jinx_room_${room.id}`, JSON.stringify(room));
  },
  
  updateRoom: async (roomId: string, updates: any) => {
    console.log(`Firebase: Updating room ${roomId}`, updates);
    const existing = JSON.parse(localStorage.getItem(`jinx_room_${roomId}`) || '{}');
    const updated = { ...existing, ...updates };
    localStorage.setItem(`jinx_room_${roomId}`, JSON.stringify(updated));
    // Trigger window event to simulate realtime update in this local session
    window.dispatchEvent(new CustomEvent('roomUpdate', { detail: updated }));
  },

  getRoom: (roomId: string, callback: (room: any) => void) => {
    const data = localStorage.getItem(`jinx_room_${roomId}`);
    if (data) callback(JSON.parse(data));
    
    const handler = (e: any) => {
        if (e.detail.id === roomId) callback(e.detail);
    };
    window.addEventListener('roomUpdate', handler);
    return () => window.removeEventListener('roomUpdate', handler);
  }
};
