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
            const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);

            // If the leaving player is the host, transfer host to another player first
            if (isHost) {
                return new Promise<void>((resolve, reject) => {
                    onValue(roomRef, async (snapshot) => {
                        const room = snapshot.val();
                        if (!room || !room.players) {
                            reject(new Error("Room not found"));
                            return;
                        }

                        const remainingPlayers = Object.keys(room.players).filter(id => id !== uid);

                        if (remainingPlayers.length > 0) {
                            // Transfer host to a random remaining player
                            const newHostId = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
                            const updates: any = {
                                hostId: newHostId,
                                [`players/${newHostId}/isHost`]: true,
                                [`players/${uid}`]: null // Remove the old host
                            };

                            await update(roomRef, updates);
                            console.log('Firebase: Host transferred to', newHostId, 'and old host removed');
                            resolve();
                        } else {
                            // No players left, delete the room
                            await remove(roomRef);
                            console.log('Firebase: Room deleted (last player left)', roomId);
                            resolve();
                        }
                    }, { onlyOnce: true });
                });
            } else {
                // Regular player leaving
                await remove(playerRef);
                console.log('Firebase: Player left room', uid);

                // Check if any players remain
                return new Promise<void>((resolve) => {
                    onValue(roomRef, (snapshot) => {
                        const room = snapshot.val();
                        if (!room || !room.players || Object.keys(room.players).length === 0) {
                            // No players left, delete the entire room
                            remove(roomRef).then(() => {
                                console.log('Firebase: Room deleted (no players remaining)', roomId);
                                resolve();
                            });
                        } else {
                            console.log('Firebase: Room still has players', Object.keys(room.players).length);
                            resolve();
                        }
                    }, { onlyOnce: true });
                });
            }
        } catch (error) {
            console.error('Firebase: Error leaving room', error);
            throw error;
        }
    }
};
