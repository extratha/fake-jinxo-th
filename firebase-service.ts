import { ref, set, update, onValue, onDisconnect, remove } from "firebase/database";
import { database } from "./firebase-config";
import { GameRoom } from "./types";

export const dbService = {
    saveRoom: async (room: GameRoom) => {
        try {
            console.log('Firebase: Attempting to save room', room.id);
            const roomRef = ref(database, `rooms/${room.id}`);
            await set(roomRef, room);

            // Auto-delete room if host disconnects - REMOVED to persist room
            // onDisconnect(roomRef).remove().catch(err => ...);

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

                const existingPlayer = room.players?.[uid];
                let updatedPlayers;

                if (existingPlayer) {
                    console.log('Firebase: Rejoining existing player', uid);
                    // Preserve existing state, just update status and maybe name
                    updatedPlayers = {
                        ...room.players,
                        [uid]: {
                            ...existingPlayer,
                            name: name, // User might have updated name, but identity is same
                            status: 'active'
                        }
                    };
                } else {
                    console.log('Firebase: Joining as new player', uid);
                    updatedPlayers = {
                        ...room.players,
                        [uid]: {
                            id: uid,
                            name,
                            isHost: false, // Default false, unless logic elsewhere handles it? (Usually host is set on creation)
                            grid: Array(9).fill(null).map(() => ({ word: '', score: 'NONE' })),
                            totalScore: 0,
                            isReady: false,
                            status: 'active'
                        }
                    };
                }

                try {
                    await update(roomRef, { players: updatedPlayers });

                    // Auto-remove player if they disconnect
                    const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);
                    onDisconnect(playerRef).update({ status: 'leaved' }).catch(err =>
                        console.error('Firebase: Failed to set onDisconnect for player', uid, err)
                    );

                    console.log('Firebase: Joined/Rejoined room successfully', roomId);
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

            // Mark the leaving player as leaved instead of removing
            await update(playerRef, { status: 'leaved' });
            console.log('Firebase: Player marked as leaved', uid);

            // Fetch the latest room data
            const snapshot = await new Promise<any>((resolve, reject) => {
                onValue(roomRef, (snap) => resolve(snap), { onlyOnce: true });
            });
            const room = snapshot.val();
            if (!room) {
                console.warn('Firebase: Room not found after leaving', roomId);
                return;
            }

            if (isHost) {
                // Transfer host to another active player (status not leaved)
                const remainingActive = Object.entries(room.players || {})
                    .filter(([id, p]) => id !== uid && (p as any).status !== 'leaved')
                    .map(([id]) => id);

                if (remainingActive.length > 0) {
                    const newHostId = remainingActive[Math.floor(Math.random() * remainingActive.length)];
                    const updates: any = {
                        hostId: newHostId,
                        [`players/${newHostId}/isHost`]: true,
                        [`players/${uid}/isHost`]: false,
                    };
                    await update(roomRef, updates);
                    console.log('Firebase: Host transferred to', newHostId);
                } else {
                    // Check if there are ANY players at all (even disconnected ones) before deleting?
                    // Actually, if no *active* players and host leaves, maybe we DO want to keep the room alive 
                    // for a bit in case they rejoin? 
                    // BUT for now, let's stick to: "If everyone is gone/leaved, delete."

                    const allLeaved = Object.values(room.players || {}).every(
                        (p: any) => p.id === uid || p.status === 'leaved'
                    );

                    if (allLeaved) {
                        // No active players left, delete the room
                        await remove(roomRef);
                        console.log('Firebase: Room deleted (no active players)', roomId);
                    } else {
                        // There are players but they are all "leaved" status (disconnected).
                        // Just give host to one of them randomly so the room has a host?
                        // Or just leave hostId pointing to the leaving user? 
                        // Let's pick a random leaved player to be host so at least someone is host if they rejoin.
                        const remainingLeaved = Object.keys(room.players || {}).filter(id => id !== uid);
                        if (remainingLeaved.length > 0) {
                            const newHostId = remainingLeaved[Math.floor(Math.random() * remainingLeaved.length)];
                            const updates: any = {
                                hostId: newHostId,
                                [`players/${newHostId}/isHost`]: true,
                                [`players/${uid}/isHost`]: false,
                            };
                            await update(roomRef, updates);
                            console.log('Firebase: Host transferred to disconnected player', newHostId);
                        }
                    }
                }
            } else {
                // For regular player, check if all players are leaved
                const allLeaved = Object.values(room.players || {}).every(
                    (p: any) => p.status === 'leaved'
                );
                if (allLeaved) {
                    await remove(roomRef);
                    console.log('Firebase: Room deleted (all players leaved)', roomId);
                }
            }
        } catch (error) {
            console.error('Firebase: Error leaving room', error);
            throw error;
        }
    },
};
