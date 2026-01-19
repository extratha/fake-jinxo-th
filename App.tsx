
import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, GameRoom, Player, GridCell, ScoreType } from './types';
import { dbService as db } from './firebase-service';

// Helper to generate empty grid
const createEmptyGrid = (): GridCell[] =>
  Array(9).fill(null).map(() => ({ word: '', score: 'NONE' }));

const App: React.FC = () => {
  const [user, setUser] = useState<{ id: string, name: string } | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [error, setError] = useState<string>('');
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [joinRidInput, setJoinRidInput] = useState('');

  const topicContainerRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load user from local storage on mount
  useEffect(() => {
    const storedUserId = localStorage.getItem('jinx_userId');
    const storedUserName = localStorage.getItem('jinx_userName');

    if (storedUserId) {
      if (storedUserName) {
        // If we have both, we can restore the session or prefill
        setNameInput(storedUserName);
        setUser({ id: storedUserId, name: storedUserName });
      } else {
        // Just ID exists? that's weird but valid
        setUser({ id: storedUserId, name: '' });
      }
    }
  }, []);

  // Update localStorage when user changes (or new one created)
  const saveUserToStorage = (id: string, name: string) => {
    localStorage.setItem('jinx_userId', id);
    localStorage.setItem('jinx_userName', name);
  };

  // Auto-join if roomId in URL or state
  useEffect(() => {
    if (roomId && user) {
      const unsubscribe = db.getRoom(roomId, (data) => {
        if (!data) {
          // Room was deleted
          setRoom(null);
          setRoomId('');
          return;
        }
        setRoom(data);
      });
      return () => unsubscribe();
    }
  }, [roomId, user]);

  // Handle click outside for tooltips
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (topicContainerRef.current && !topicContainerRef.current.contains(event.target as Node)) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle click outside for modal
  useEffect(() => {
    const handleModalClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setViewingPlayerId(null);
      }
    };
    if (viewingPlayerId) {
      document.addEventListener("mousedown", handleModalClickOutside);
      return () => document.removeEventListener("mousedown", handleModalClickOutside);
    }
  }, [viewingPlayerId]);

  // Host Claim Logic: If host disconnects, remaining players pick a new host
  useEffect(() => {
    if (!room || !user || !room.players) return;

    const hostPlayer = room.players[room.hostId];
    // If host is effectively gone (status is leaved OR they don't exist in players map)
    const isHostGone = !hostPlayer || hostPlayer.status === 'leaved';

    if (isHostGone) {
      // Find all active players
      const activePlayers = (Object.values(room.players) as Player[]).filter(p => p.status !== 'leaved');

      if (activePlayers.length > 0) {
        // Deterministic Leader Election:
        // Sort players by ID. The first one is the "Temporary Leader" responsible for the update.
        // This prevents race conditions where everyone tries to update Firebase at once.
        activePlayers.sort((a, b) => a.id.localeCompare(b.id)); // String sort by ID

        const leader = activePlayers[0];

        // If I am the leader, I perform the update
        if (user.id === leader.id) {
          // Pick a RANDOM player from the active ones to be the new host
          const newHostCandidate = activePlayers[Math.floor(Math.random() * activePlayers.length)];
          const newHostId = newHostCandidate.id;

          console.log(`App: Host ${room.hostId} is gone. I am leader (${user.id}). Assigning new host: ${newHostId}`);

          const updates: any = {
            hostId: newHostId,
            [`players/${newHostId}/isHost`]: true,
          };

          // If the old host still exists in the map, unset their flag
          if (hostPlayer) {
            updates[`players/${room.hostId}/isHost`] = false;
          }

          db.updateRoom(room.id, updates).catch(err => console.error("Failed to claim host", err));
        }
      }
    }
  }, [room, user]);

  const handleCreateRoom = async (name: string) => {
    if (name.length > 24) {
      setError("Name must be 24 characters or less");
      return;
    }

    // Use existing ID or generate new one
    const uid = user?.id || Math.random().toString(36).substr(2, 9);
    saveUserToStorage(uid, name);

    const rid = Math.floor(1000 + Math.random() * 9000).toString();
    const newUser = { id: uid, name };

    const newRoom: GameRoom = {
      id: rid,
      hostId: uid,
      topics: ['', '', ''],
      phase: GamePhase.LOBBY,
      players: {
        [uid]: {
          id: uid,
          name,
          isHost: true,
          grid: createEmptyGrid(),
          totalScore: 0,
          isReady: false,
          status: 'active'
        }
      },
      createdAt: Date.now()
    };

    setUser(newUser);
    setRoomId(rid);
    await db.saveRoom(newRoom);
  };

  const handleJoinRoom = async (name: string, targetRid: string) => {
    if (name.length > 24) {
      setError("Name must be 24 characters or less");
      return;
    }

    // Use existing ID or generate new one
    const uid = user?.id || Math.random().toString(36).substr(2, 9);
    saveUserToStorage(uid, name);

    try {
      await db.joinRoom(targetRid, uid, name);
      setUser({ id: uid, name });
      setRoomId(targetRid);
      setError('');
    } catch (err: any) {
      setError(err.message || "Failed to join room");
    }
  };

  const handleLeaveRoom = async () => {
    if (!room || !user) return;
    try {
      await db.leaveRoom(room.id, user.id, user.id === room.hostId);
      setRoom(null);
      setRoomId('');
    } catch (err: any) {
      setError(err.message || "Failed to leave room");
    }
  };

  const updatePhase = async (nextPhase: GamePhase) => {
    if (room) {
      await db.updateRoom(room.id, { phase: nextPhase });
    }
  };

  const handleRestart = async () => {
    if (!room || user?.id !== room.hostId) return;

    const resetPlayers = { ...room.players };
    Object.keys(resetPlayers).forEach(key => {
      resetPlayers[key] = {
        ...resetPlayers[key],
        grid: createEmptyGrid(),
        isReady: false
      };
    });

    await db.updateRoom(room.id, {
      phase: GamePhase.SELECT_TOPICS,
      topics: ['', '', ''],
      players: resetPlayers
    });
  };

  const updateGrid = (gridIndex: number, word: string) => {
    if (!room || !user) return;
    const newPlayers = { ...room.players };
    newPlayers[user.id].grid[gridIndex].word = word;
    // Optimistic update local state only
    setRoom({ ...room, players: newPlayers });
  };

  const saveGridToDb = async (gridIndex: number, word: string) => {
    if (!room || !user) return;
    const newPlayers = { ...room.players };
    newPlayers[user.id].grid[gridIndex].word = word;
    await db.updateRoom(room.id, { players: newPlayers });
  };

  const cycleScore = async (gridIndex: number) => {
    if (!room || !user) return;
    if (room.phase !== GamePhase.SCORING && room.phase !== GamePhase.VALIDATION) return;

    const newPlayers = { ...room.players };
    const currentScore = newPlayers[user.id].grid[gridIndex].score;
    const scores: ScoreType[] = ['NONE', 'O', 'X', 'STAR'];
    const nextIdx = (scores.indexOf(currentScore) + 1) % scores.length;
    newPlayers[user.id].grid[gridIndex].score = scores[nextIdx];

    await db.updateRoom(room.id, { players: newPlayers });
  };

  const calculateFinalScores = async () => {
    if (!room) return;
    const newPlayers = { ...room.players };
    (Object.values(newPlayers) as Player[]).forEach(p => {
      let roundTotal = 0;

      // 1. Base Score
      p.grid.forEach(cell => {
        if (cell.score === 'O') roundTotal += 1;
        if (cell.score === 'STAR') roundTotal += 2;
      });

      // 2. Row Bonuses (Indices: 0-2, 3-5, 6-8)
      // Row 1 (Top): +3, Row 2 (Mid): +2, Row 3 (Bot): +1
      const rowBonuses = [3, 2, 1];
      for (let r = 0; r < 3; r++) {
        const start = r * 3;
        const isBingo = [0, 1, 2].every(offset => {
          const s = p.grid[start + offset].score;
          return s === 'O' || s === 'STAR';
        });
        if (isBingo) roundTotal += rowBonuses[r];
      }

      // 3. Col Bonuses (Indices: [0,3,6], [1,4,7], [2,5,8])
      // Col 1 (Left): +1, Col 2 (Mid): +2, Col 3 (Right): +3
      const colBonuses = [1, 2, 3];
      for (let c = 0; c < 3; c++) {
        const isBingo = [0, 1, 2].every(offset => {
          const s = p.grid[c + (offset * 3)].score;
          return s === 'O' || s === 'STAR';
        });
        if (isBingo) roundTotal += colBonuses[c];
      }

      p.totalScore += roundTotal;
    });
    await db.updateRoom(room.id, { players: newPlayers, phase: GamePhase.FINISHED });
  };

  if (!user || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-800">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-indigo-400 tracking-tight">JINX O</h1>
            <p className="text-slate-400 mt-2">The unique word-matching board game</p>
          </div>

          {error && <div className="bg-red-900/30 text-red-400 p-3 rounded-xl mb-4 text-sm border border-red-800/50">{error}</div>}

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Your Name (Max 24)"
              maxLength={24}
              className="w-full px-5 py-3 rounded-2xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-800 text-slate-100 placeholder-slate-500"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <div className="h-[1px] bg-slate-800 my-4"></div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  if (nameInput) handleCreateRoom(nameInput);
                }}
                className="w-full py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg hover:opacity-90 transition-all active:scale-95"
              >
                Create New Room
              </button>
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-widest">or join one</span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>
              <input
                type="text"
                placeholder="Enter 4-digit Room Code"
                className="w-full px-5 py-3 rounded-2xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-800 text-slate-100 text-center text-xl tracking-widest font-mono placeholder-slate-500"
                value={joinRidInput}
                onChange={(e) => setJoinRidInput(e.target.value)}
              />
              <button
                onClick={() => {
                  if (nameInput && joinRidInput) handleJoinRoom(nameInput, joinRidInput);
                }}
                className="w-full py-4 bg-slate-800 border-2 border-indigo-500 text-indigo-400 font-bold rounded-2xl hover:bg-slate-700 transition-all active:scale-95"
              >
                Join Room
              </button>
            </div>
          </div>
        </div>
      </div>
    );

  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20 font-sans">
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shadow-md">
        <div className="truncate max-w-[40%]">
          <h2 className="text-xl font-bold text-indigo-400">JINX O</h2>
          <p className="text-xs text-slate-500">Room: <span className="font-mono font-bold text-slate-400">{room.id}</span></p>
        </div>
        <div className="flex items-center gap-4 max-w-[60%]">
          <div className="text-right truncate hidden sm:block">
            <p className="text-sm font-semibold truncate text-slate-200" title={user.name}>{user.name}</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${room.players?.[user.id]?.isHost ? 'bg-amber-900/40 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
              {room.players?.[user.id]?.isHost ? 'Host' : 'Player'}
            </span>
          </div>
          <button
            onClick={handleLeaveRoom}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors text-xs font-bold border border-red-800/30"
          >
            Leave
          </button>
        </div>
      </header>

      {/* Defensive check: Ensure player exists in the room data */}
      {
        !room.players?.[user.id] ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-slate-400 mt-4 font-medium">Syncing your player data...</p>
            <p className="text-xs text-slate-600 mt-2">If this takes too long, please try refreshing.</p>
          </div>
        ) : (
          <main className="max-w-6xl mx-auto p-4 md:p-8">
            <div className="mb-8 flex justify-center">
              <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 px-6 py-3 inline-flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></div>
                <h3 className="font-bold text-slate-300 tracking-wide uppercase text-sm">
                  {room.phase.replace('_', ' ')}
                </h3>
              </div>
            </div>

            {room.phase === GamePhase.LOBBY && (
              <div className="bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-800 text-center max-w-2xl mx-auto">
                <h3 className="text-2xl font-bold mb-4 text-slate-100">Waiting for players...</h3>
                <div className="flex flex-wrap justify-center gap-4 mb-8">
                  {(Object.values(room.players || {}) as Player[]).map(p => (
                    <div key={p.id} className="bg-slate-800 px-6 py-3 rounded-2xl border border-slate-700 flex items-center gap-3 max-w-[200px]">
                      <div className="w-8 h-8 rounded-full bg-indigo-900/50 text-indigo-300 flex-shrink-0 flex items-center justify-center font-bold">
                        {p.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span className="font-medium truncate text-slate-200" title={p.name}>{p.name}</span>
                    </div>
                  ))}
                </div>
                {user.id === room.hostId && (
                  <button
                    onClick={() => updatePhase(GamePhase.SELECT_TOPICS)}
                    className="px-10 py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg hover:scale-105 transition-transform"
                  >
                    Start Game
                  </button>
                )}
              </div>
            )}

            {room.phase === GamePhase.SELECT_TOPICS && (
              <div className="bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-800 max-w-2xl mx-auto">
                <h3 className="text-2xl font-bold mb-6 text-center text-slate-100">Set 3 Game Topics</h3>
                {user.id === room.hostId ? (
                  <div className="space-y-4 max-w-md mx-auto">
                    {[0, 1, 2].map(i => (
                      <input
                        key={i}
                        type="text"
                        placeholder={`Topic ${i + 1}`}
                        className="w-full px-5 py-4 rounded-xl border border-slate-700 bg-slate-800 text-slate-100 focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
                        onChange={(e) => {
                          const newTopics = [...(room.topics || [])];
                          newTopics[i] = e.target.value;
                          db.updateRoom(room.id, { topics: newTopics });
                        }}
                      />
                    ))}
                    <button
                      onClick={() => updatePhase(GamePhase.WRITING)}
                      className="w-full py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg mt-4"
                    >
                      Confirm Topics
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <p className="text-slate-400 italic">The host is choosing topics...</p>
                    <div className="flex justify-center gap-2 mt-4">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(room.phase === GamePhase.WRITING || room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION || room.phase === GamePhase.FINISHED) && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                <div className="lg:col-span-8 flex flex-col items-center">
                  {/* Stacked Topics with Tooltip Support */}
                  <div className="mb-8 flex flex-col items-center gap-2 w-full max-w-md pr-10" ref={topicContainerRef}>
                    {(room.topics || []).map((t, i) => (
                      <div key={i} className="relative w-full group">
                        <button
                          onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
                          className="w-full bg-indigo-900/30 text-indigo-300 px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold uppercase truncate border border-indigo-800/50 hover:bg-indigo-900/50 transition-colors shadow-sm cursor-help text-center"
                        >
                          {t || 'Topic ' + (i + 1)}
                        </button>
                        {activeTooltip === i && t && (
                          <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-2 w-full max-w-[280px] p-3 bg-slate-800 text-slate-100 text-xs rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
                            <p className="font-medium text-center break-words whitespace-normal leading-relaxed">
                              {t}
                            </p>
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800"></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 w-full max-w-md">
                    <div className="flex-1">
                      <div className="grid grid-cols-3 gap-2 bg-slate-900 p-2 rounded-2xl shadow-2xl aspect-square w-full border border-slate-800">
                        {room.players?.[user.id]?.grid?.map((cell, idx) => (
                          <div
                            key={idx}
                            onClick={() => room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION ? cycleScore(idx) : null}
                            className={`
                          grid-cell flex flex-col items-center justify-center p-1 rounded-xl relative overflow-hidden cursor-pointer aspect-square
                          ${room.phase === GamePhase.WRITING ? 'bg-slate-800' : 'bg-slate-800/70'}
                          ${cell.score === 'O' ? 'border-4 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]' : ''}
                          ${cell.score === 'X' ? 'border-4 border-red-500 opacity-60' : ''}
                          ${cell.score === 'STAR' ? 'border-4 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)] bg-amber-900/20' : ''}
                          ${cell.score === 'NONE' ? 'border border-slate-700' : ''}
                        `}
                          >
                            {/* THE WORD AREA (Wraps up to 24 chars) */}
                            <div className="w-full h-full flex items-center justify-center p-1">
                              {room.phase === GamePhase.WRITING ? (
                                <textarea
                                  value={cell.word}
                                  placeholder="..."
                                  maxLength={24}
                                  onChange={(e) => updateGrid(idx, e.target.value)}
                                  onBlur={(e) => saveGridToDb(idx, e.target.value)}
                                  className="w-full h-full bg-transparent text-center focus:outline-none font-bold text-slate-100 text-[10px] md:text-xs resize-none flex items-center justify-center pt-2 placeholder-slate-600"
                                  style={{ verticalAlign: 'middle' }}
                                />
                              ) : (
                                <span className="font-bold text-slate-200 text-[10px] md:text-sm text-center leading-tight break-words max-w-full">
                                  {cell.word || '-'}
                                </span>
                              )}
                            </div>

                            {/* SCORE ICON OVERLAY (Absolute layer, doesn't shift word) */}
                            {room.phase !== GamePhase.WRITING && cell.score !== 'NONE' && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                                {cell.score === 'O' && <span className="text-green-400 text-4xl md:text-6xl font-black opacity-30 select-none">O</span>}
                                {cell.score === 'X' && <span className="text-red-400 text-4xl md:text-6xl font-black opacity-30 select-none">X</span>}
                                {cell.score === 'STAR' && <span className="text-amber-400 text-3xl md:text-5xl opacity-40 select-none">⭐</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-around text-slate-600 font-bold text-sm mt-3">
                        <span className="w-1/3 text-center">1</span>
                        <span className="w-1/3 text-center">2</span>
                        <span className="w-1/3 text-center">3</span>
                      </div>
                    </div>

                    <div className="flex flex-col justify-between text-slate-600 font-bold text-sm h-[80%] py-4 pb-12">
                      <div className="h-1/3 flex items-center">3</div>
                      <div className="h-1/3 flex items-center">2</div>
                      <div className="h-1/3 flex items-center">1</div>
                    </div>
                  </div>

                  <div className="mt-8 flex flex-col items-center gap-4">
                    {room.phase === GamePhase.WRITING && (
                      user.id === room.hostId ? (
                        <button
                          onClick={() => updatePhase(GamePhase.SCORING)}
                          className="px-8 py-3 jinx-gradient text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                        >
                          Lock Board & Start Scoring
                        </button>
                      ) : (
                        <p className="text-slate-400 italic text-sm flex items-center gap-2">
                          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                          Waiting for host to lock boards...
                        </p>
                      )
                    )}

                    {room.phase === GamePhase.SCORING && (
                      user.id === room.hostId ? (
                        <button
                          onClick={() => updatePhase(GamePhase.VALIDATION)}
                          className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                        >
                          Reveal to Everyone (Validation)
                        </button>
                      ) : (
                        <p className="text-slate-400 italic text-sm flex items-center gap-2">
                          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                          Waiting for host to reveal boards...
                        </p>
                      )
                    )}

                    {room.phase === GamePhase.VALIDATION && (
                      user.id === room.hostId ? (
                        <button
                          onClick={calculateFinalScores}
                          className="px-8 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                        >
                          Confirm & Finish Game
                        </button>
                      ) : (
                        <p className="text-slate-400 italic text-sm flex items-center gap-2">
                          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          Waiting for host to finalize scores...
                        </p>
                      )
                    )}
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-800">
                    <h4 className="font-bold text-slate-100 mb-4 flex items-center justify-between">
                      <span>Players</span>
                      <span className="bg-slate-800 text-slate-500 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-tighter">Live</span>
                    </h4>
                    <div className="space-y-4">
                      {(Object.values(room.players || {}) as Player[]).map(p => (
                        <div key={p.id} className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <div className="flex items-center gap-3 max-w-[70%]">
                            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-xs ${p.id === user.id ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                              {p.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <span className={`text-xs font-medium truncate ${p.id === user.id ? 'text-indigo-400 font-bold' : 'text-slate-300'}`} title={p.name}>
                              {p.name} {p.id === user.id && '(You)'}
                              {room.hostId === p.id && '(Host)'}
                            </span>
                            {room.phase === GamePhase.VALIDATION && (
                              <button
                                onClick={() => setViewingPlayerId(p.id)}
                                className="ml-2 text-slate-500 hover:text-indigo-400 transition-colors"
                                title={`View ${p.name}'s board`}
                              >
                                👁️
                              </button>
                            )}
                          </div>
                          <span className="font-mono font-bold text-sm text-indigo-400 flex-shrink-0">{p.totalScore || 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(room.phase === GamePhase.VALIDATION || room.phase === GamePhase.FINISHED) && (
                    <div className="bg-indigo-950 rounded-3xl p-6 text-white shadow-2xl border border-indigo-900/50">
                      <h4 className="font-bold mb-4 flex items-center gap-2 text-indigo-200">
                        <span className="text-xl">🏆</span> Leaderboard
                      </h4>
                      <div className="space-y-3">
                        {(Object.values(room.players || {}) as Player[])
                          .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
                          .map((p, idx) => (
                            <div key={p.id} className="flex items-center justify-between bg-white/5 px-4 py-2 rounded-xl border border-white/5">
                              <span className="text-xs font-semibold opacity-80 truncate max-w-[70%] text-indigo-100" title={p.name}>{idx + 1}. {p.name}</span>
                              <span className="font-bold text-sm flex-shrink-0 text-indigo-300">{p.totalScore || 0} pts</span>
                            </div>
                          ))}
                      </div>

                      {user.id === room.hostId && (
                        <button
                          onClick={handleRestart}
                          className="w-full mt-6 py-3 bg-indigo-500 text-white font-bold rounded-xl hover:bg-indigo-400 transition-all active:scale-95 shadow-lg"
                        >
                          Restart Round
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        )
      }

      {/* Player Board Viewer Modal */}
      {viewingPlayerId && room.players?.[viewingPlayerId] && (
        viewingPlayerId && room.players?.[viewingPlayerId] && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={modalRef} className="bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-700 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-slate-100">
                  {room.players[viewingPlayerId].name}'s Board
                </h3>
                <button
                  onClick={() => setViewingPlayerId(null)}
                  className="text-slate-400 hover:text-slate-200 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-slate-800 p-3 rounded-2xl">
                {room.players[viewingPlayerId].grid?.map((cell, idx) => (
                  <div
                    key={idx}
                    className={`
                    flex flex-col items-center justify-center p-3 rounded-xl relative aspect-square
                    ${cell.score === 'O' ? 'border-4 border-green-500 bg-slate-700' : ''}
                    ${cell.score === 'X' ? 'border-4 border-red-500 bg-slate-700 opacity-60' : ''}
                    ${cell.score === 'STAR' ? 'border-4 border-amber-500 bg-amber-900/20' : ''}
                    ${cell.score === 'NONE' ? 'border border-slate-600 bg-slate-700' : ''}
                  `}
                  >
                    <span className="font-bold text-slate-200 text-sm text-center leading-tight break-words max-w-full">
                      {cell.word || '-'}
                    </span>

                    {cell.score !== 'NONE' && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10">
                        {cell.score === 'O' && <span className="text-green-400 text-5xl font-black opacity-30">O</span>}
                        {cell.score === 'X' && <span className="text-red-400 text-5xl font-black opacity-30">X</span>}
                        {cell.score === 'STAR' && <span className="text-amber-400 text-4xl opacity-40">⭐</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 text-center">
                <span className="text-slate-400 text-sm">Total Score: </span>
                <span className="text-indigo-400 font-bold text-lg">{room.players[viewingPlayerId].totalScore || 0}</span>
              </div>
            </div>
          </div>
        ))
      }

      {
        (room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION) && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md px-4 md:px-6 py-2 rounded-full shadow-2xl border border-slate-700 flex items-center gap-4 md:gap-6 z-20">
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-green-400 font-black text-lg md:text-xl">O</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase">1pt</span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-red-400 font-black text-lg md:text-xl">X</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase">0pt</span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-amber-400 text-lg md:text-xl">⭐</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase">3pts</span>
            </div>
            <div className="w-[1px] h-4 bg-slate-700"></div>
            <span className="text-[8px] md:text-[10px] text-slate-500 font-medium uppercase italic hidden xs:block">Tap cell to score</span>
          </div>
        )
      }
    </div >
  );
};

export default App;
