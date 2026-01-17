import { ref, set, update, onValue, onDisconnect, remove } from "firebase/database";
import { database } from "./firebase-config";
import { GameRoom } from "./types";

export const dbService = {
    saveRoom: async (room: GameRoom) => {
        try {
            console.log('Firebase: Attempting to save room', room.id);
            const roomRef = ref(database, `rooms/${room.id}`);
            await set(roomRef, room);

            // Auto-delete room if host disconnects
            onDisconnect(roomRef).remove().catch(err =>
                console.error('Firebase: Failed to set onDisconnect for room', room.id, err)
            );

            console.log('Firebase: Room saved successfully', room.id);
        } catch (error) {
            console.error('Firebase: Error saving room', room.id, error);
            throw error;
        }
    },

    updateRoom: async (roomId: string, updates: any) => {
        try {
            console.log('Firebase: Attempting to update room', roomId, updates);
            const roomRef = ref(database, `rooms/${roomId}`);
            await update(roomRef, updates);
            console.log('Firebase: Room updated successfully', roomId);
        } catch (error) {
            console.error('Firebase: Error updating room', roomId, error);
            throw error;
        }
    },

    getRoom: (roomId: string, callback: (room: GameRoom) => void) => {
        console.log('Firebase: Subscribing to room', roomId);
        const roomRef = ref(database, `rooms/${roomId}`);
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            console.log('Firebase: Received room data', roomId, data);
            if (data) {
                callback(data);
            }
        }, (error) => {
            console.error('Firebase: Error listening to room', roomId, error);
        });
        return unsubscribe;
    },

    joinRoom: async (roomId: string, uid: string, name: string) => {
        console.log('Firebase: Attempting to join room', roomId, 'as', name);
        const roomRef = ref(database, `rooms/${roomId}`);

        return new Promise<void>((resolve, reject) => {
            onValue(roomRef, async (snapshot) => {
                const room = snapshot.val() as GameRoom;
                if (!room) {
                    console.error('Firebase: Room not found', roomId);
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
                try {
                    await update(roomRef, { players: updatedPlayers });

                    // Auto-remove player if they disconnect
                    const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);
                    onDisconnect(playerRef).remove().catch(err =>
                        console.error('Firebase: Failed to set onDisconnect for player', uid, err)
                    );

                    console.log('Firebase: Joined room successfully', roomId);
                    resolve();
                } catch (error) {
                    console.error('Firebase: Error updating players during join', roomId, error);
                    reject(error);
                }
            }, { onlyOnce: true });
        });
    },

    leaveRoom: async (roomId: string, uid: string, isHost: boolean) => {
        try {
            const roomRef = ref(database, `rooms/${roomId}`);
            if (isHost) {
                // Host leaves -> Delete entire room
                await remove(roomRef);
                console.log('Firebase: Room deleted by host', roomId);
            } else {
                // Player leaves -> Just remove them
                const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);
                await remove(playerRef);
                console.log('Firebase: Player left room', uid);
            }
        } catch (error) {
            console.error('Firebase: Error leaving room', error);
            throw error;
        }
    }
};
