import { ref, set, update, onValue } from "firebase/database";
import { database } from "./firebase-config";
import { GameRoom } from "./types";

export const dbService = {
    saveRoom: async (room: GameRoom) => {
        const roomRef = ref(database, `rooms/${room.id}`);
        await set(roomRef, room);
    },

    updateRoom: async (roomId: string, updates: any) => {
        const roomRef = ref(database, `rooms/${roomId}`);
        await update(roomRef, updates);
    },

    getRoom: (roomId: string, callback: (room: GameRoom) => void) => {
        const roomRef = ref(database, `rooms/${roomId}`);
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                callback(data);
            }
        });
        return unsubscribe;
    },

    joinRoom: async (roomId: string, uid: string, name: string) => {
        const roomRef = ref(database, `rooms/${roomId}`);
        // We need to fetch the room first, then update players.
        // In a real app, you might use a transaction or a specific path for players.
        // For simplicity with the existing App.tsx structure:
        return new Promise<void>((resolve, reject) => {
            onValue(roomRef, async (snapshot) => {
                const room = snapshot.val() as GameRoom;
                if (!room) {
                    reject(new Error("Room not found"));
                    return;
                }
                const updatedPlayers = {
                    ...room.players,
                    [uid]: {
                        id: uid,
                        name,
                        isHost: false,
                        grid: Array(9).fill(null).map(() => ({ word: '', score: 'NONE' })),
                        totalScore: 0,
                        isReady: false
                    }
                };
                await update(roomRef, { players: updatedPlayers });
                resolve();
            }, { onlyOnce: true });
        });
    }
};
