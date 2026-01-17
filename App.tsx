
import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, GameRoom, Player, GridCell, ScoreType } from './types';
import { mockDb } from './firebase-mock';

// Helper to generate empty grid
const createEmptyGrid = (): GridCell[] => 
  Array(9).fill(null).map(() => ({ word: '', score: 'NONE' }));

const App: React.FC = () => {
  const [user, setUser] = useState<{ id: string, name: string } | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [error, setError] = useState<string>('');
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const themeContainerRef = useRef<HTMLDivElement>(null);

  // Auto-join if roomId in URL or state
  useEffect(() => {
    if (roomId && user) {
      const unsubscribe = mockDb.getRoom(roomId, (data) => {
        setRoom(data);
      });
      return () => unsubscribe();
    }
  }, [roomId, user]);

  // Handle click outside for tooltips
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (themeContainerRef.current && !themeContainerRef.current.contains(event.target as Node)) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreateRoom = async (name: string) => {
    if (name.length > 24) {
      setError("Name must be 24 characters or less");
      return;
    }
    const uid = Math.random().toString(36).substr(2, 9);
    const rid = Math.floor(1000 + Math.random() * 9000).toString();
    const newUser = { id: uid, name };
    
    const newRoom: GameRoom = {
      id: rid,
      hostId: uid,
      themes: [],
      phase: GamePhase.LOBBY,
      players: {
        [uid]: {
          id: uid,
          name,
          isHost: true,
          grid: createEmptyGrid(),
          totalScore: 0,
          isReady: false
        }
      },
      createdAt: Date.now()
    };

    setUser(newUser);
    setRoomId(rid);
    await mockDb.saveRoom(newRoom);
  };

  const handleJoinRoom = async (name: string, targetRid: string) => {
    if (name.length > 24) {
      setError("Name must be 24 characters or less");
      return;
    }
    const uid = Math.random().toString(36).substr(2, 9);
    setUser({ id: uid, name });
    setRoomId(targetRid);
    
    const data = localStorage.getItem(`jinx_room_${targetRid}`);
    if (!data) {
        setError("Room not found");
        return;
    }
    const existingRoom: GameRoom = JSON.parse(data);
    
    const updatedPlayers = {
      ...existingRoom.players,
      [uid]: {
        id: uid,
        name,
        isHost: false,
        grid: createEmptyGrid(),
        totalScore: 0,
        isReady: false
      }
    };

    await mockDb.updateRoom(targetRid, { players: updatedPlayers });
  };

  const updatePhase = async (nextPhase: GamePhase) => {
    if (room) {
      await mockDb.updateRoom(room.id, { phase: nextPhase });
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

    await mockDb.updateRoom(room.id, { 
      phase: GamePhase.SELECT_THEMES,
      themes: [],
      players: resetPlayers 
    });
  };

  const updateGrid = async (gridIndex: number, word: string) => {
    if (!room || !user) return;
    const newPlayers = { ...room.players };
    newPlayers[user.id].grid[gridIndex].word = word;
    await mockDb.updateRoom(room.id, { players: newPlayers });
  };

  const cycleScore = async (gridIndex: number) => {
    if (!room || !user) return;
    if (room.phase !== GamePhase.SCORING && room.phase !== GamePhase.VALIDATION) return;
    
    const newPlayers = { ...room.players };
    const currentScore = newPlayers[user.id].grid[gridIndex].score;
    const scores: ScoreType[] = ['NONE', 'O', 'X', 'STAR'];
    const nextIdx = (scores.indexOf(currentScore) + 1) % scores.length;
    newPlayers[user.id].grid[gridIndex].score = scores[nextIdx];
    
    await mockDb.updateRoom(room.id, { players: newPlayers });
  };

  const calculateFinalScores = async () => {
    if (!room) return;
    const newPlayers = { ...room.players };
    (Object.values(newPlayers) as Player[]).forEach(p => {
      let roundTotal = 0;
      p.grid.forEach(cell => {
        if (cell.score === 'O') roundTotal += 1;
        if (cell.score === 'STAR') roundTotal += 3;
      });
      p.totalScore += roundTotal;
    });
    await mockDb.updateRoom(room.id, { players: newPlayers, phase: GamePhase.FINISHED });
  };

  if (!user || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-indigo-600 tracking-tight">JINX O</h1>
            <p className="text-slate-500 mt-2">The unique word-matching board game</p>
          </div>
          
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-4 text-sm">{error}</div>}

          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Your Name (Max 24)" 
              maxLength={24}
              className="w-full px-5 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              id="playerName"
            />
            <div className="h-[1px] bg-slate-100 my-4"></div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  const name = (document.getElementById('playerName') as HTMLInputElement).value;
                  if (name) handleCreateRoom(name);
                }}
                className="w-full py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg hover:opacity-90 transition-all active:scale-95"
              >
                Create New Room
              </button>
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-4 text-slate-400 text-xs uppercase tracking-widest">or join one</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>
              <input 
                type="text" 
                placeholder="Enter 4-digit Room Code" 
                className="w-full px-5 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 text-center text-xl tracking-widest font-mono"
                id="joinRid"
              />
              <button 
                onClick={() => {
                  const name = (document.getElementById('playerName') as HTMLInputElement).value;
                  const rid = (document.getElementById('joinRid') as HTMLInputElement).value;
                  if (name && rid) handleJoinRoom(name, rid);
                }}
                className="w-full py-4 bg-white border-2 border-indigo-600 text-indigo-600 font-bold rounded-2xl hover:bg-indigo-50 transition-all active:scale-95"
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
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div className="truncate max-w-[50%]">
          <h2 className="text-xl font-bold text-indigo-600">JINX O</h2>
          <p className="text-xs text-slate-400">Room: <span className="font-mono font-bold text-slate-600">{room.id}</span></p>
        </div>
        <div className="flex items-center gap-4 max-w-[50%]">
          <div className="text-right truncate">
            <p className="text-sm font-semibold truncate" title={user.name}>{user.name}</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${room.players[user.id]?.isHost ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
              {room.players[user.id]?.isHost ? 'Host' : 'Player'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="mb-8 flex justify-center">
           <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-3 inline-flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></div>
              <h3 className="font-bold text-slate-700 tracking-wide uppercase text-sm">
                {room.phase.replace('_', ' ')}
              </h3>
           </div>
        </div>

        {room.phase === GamePhase.LOBBY && (
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 text-center max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold mb-4">Waiting for players...</h3>
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {(Object.values(room.players) as Player[]).map(p => (
                <div key={p.id} className="bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100 flex items-center gap-3 max-w-[200px]">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex-shrink-0 flex items-center justify-center font-bold">
                    {p.name[0].toUpperCase()}
                  </div>
                  <span className="font-medium truncate" title={p.name}>{p.name}</span>
                </div>
              ))}
            </div>
            {user.id === room.hostId && (
              <button 
                onClick={() => updatePhase(GamePhase.SELECT_THEMES)}
                className="px-10 py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg hover:scale-105 transition-transform"
              >
                Start Game
              </button>
            )}
          </div>
        )}

        {room.phase === GamePhase.SELECT_THEMES && (
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold mb-6 text-center">Set 3 Game Themes</h3>
            {user.id === room.hostId ? (
              <div className="space-y-4 max-w-md mx-auto">
                {[0, 1, 2].map(i => (
                  <input 
                    key={i}
                    type="text" 
                    placeholder={`Theme ${i+1}`}
                    className="w-full px-5 py-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                    onChange={(e) => {
                      const newThemes = [...room.themes];
                      newThemes[i] = e.target.value;
                      mockDb.updateRoom(room.id, { themes: newThemes });
                    }}
                  />
                ))}
                <button 
                  onClick={() => updatePhase(GamePhase.WRITING)}
                  className="w-full py-4 jinx-gradient text-white font-bold rounded-2xl shadow-lg mt-4"
                >
                  Confirm Themes
                </button>
              </div>
            ) : (
              <div className="text-center py-10">
                <p className="text-slate-500 italic">The host is choosing themes...</p>
                <div className="flex justify-center gap-2 mt-4">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                </div>
              </div>
            )}
          </div>
        )}

        {(room.phase === GamePhase.WRITING || room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION || room.phase === GamePhase.FINISHED) && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            <div className="lg:col-span-8 flex flex-col items-center">
              {/* Stacked Themes with Tooltip Support */}
              <div className="mb-8 flex flex-col items-center gap-2 w-full max-w-md pr-10" ref={themeContainerRef}>
                {room.themes.map((t, i) => (
                  <div key={i} className="relative w-full group">
                    <button 
                      onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
                      className="w-full bg-indigo-50 text-indigo-700 px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold uppercase truncate border border-indigo-100 hover:bg-indigo-100 transition-colors shadow-sm cursor-help text-center"
                    >
                      {t || 'Theme ' + (i+1)}
                    </button>
                    {activeTooltip === i && t && (
                      <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-2 w-full max-w-[280px] p-3 bg-slate-800 text-white text-xs rounded-xl shadow-xl animate-in fade-in slide-in-from-bottom-2">
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
                  <div className="grid grid-cols-3 gap-2 bg-slate-200 p-2 rounded-2xl shadow-inner aspect-square w-full">
                    {room.players[user.id].grid.map((cell, idx) => (
                      <div 
                        key={idx}
                        onClick={() => room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION ? cycleScore(idx) : null}
                        className={`
                          grid-cell flex flex-col items-center justify-center p-1 rounded-xl relative overflow-hidden cursor-pointer aspect-square
                          ${room.phase === GamePhase.WRITING ? 'bg-white' : 'bg-slate-50'}
                          ${cell.score === 'O' ? 'border-4 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]' : ''}
                          ${cell.score === 'X' ? 'border-4 border-red-500 opacity-70' : ''}
                          ${cell.score === 'STAR' ? 'border-4 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)] bg-amber-50' : ''}
                          ${cell.score === 'NONE' ? 'border border-slate-200' : ''}
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
                              className="w-full h-full bg-transparent text-center focus:outline-none font-bold text-slate-800 text-[10px] md:text-xs resize-none flex items-center justify-center pt-2"
                              style={{ verticalAlign: 'middle' }}
                            />
                          ) : (
                            <span className="font-bold text-slate-700 text-[10px] md:text-sm text-center leading-tight break-words max-w-full">
                              {cell.word || '-'}
                            </span>
                          )}
                        </div>

                        {/* SCORE ICON OVERLAY (Absolute layer, doesn't shift word) */}
                        {room.phase !== GamePhase.WRITING && cell.score !== 'NONE' && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-white/10">
                             {cell.score === 'O' && <span className="text-green-600 text-4xl md:text-6xl font-black opacity-40 select-none">O</span>}
                             {cell.score === 'X' && <span className="text-red-600 text-4xl md:text-6xl font-black opacity-40 select-none">X</span>}
                             {cell.score === 'STAR' && <span className="text-amber-500 text-3xl md:text-5xl opacity-50 select-none">⭐</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex justify-around text-slate-400 font-bold text-sm mt-3">
                    <span className="w-1/3 text-center">1</span>
                    <span className="w-1/3 text-center">2</span>
                    <span className="w-1/3 text-center">3</span>
                  </div>
                </div>

                <div className="flex flex-col justify-between text-slate-400 font-bold text-sm h-[80%] py-4 pb-12">
                  <div className="h-1/3 flex items-center">3</div>
                  <div className="h-1/3 flex items-center">2</div>
                  <div className="h-1/3 flex items-center">1</div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap justify-center gap-4">
                {room.phase === GamePhase.WRITING && (
                  <button 
                    onClick={() => updatePhase(GamePhase.SCORING)}
                    className="px-8 py-3 jinx-gradient text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                  >
                    Lock Board & Start Scoring
                  </button>
                )}
                
                {room.phase === GamePhase.SCORING && (
                  <button 
                    onClick={() => updatePhase(GamePhase.VALIDATION)}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                  >
                    Reveal to Everyone (Validation)
                  </button>
                )}

                {room.phase === GamePhase.VALIDATION && user.id === room.hostId && (
                  <button 
                    onClick={calculateFinalScores}
                    className="px-8 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
                  >
                    Confirm & Finish Game
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                <h4 className="font-bold text-slate-800 mb-4 flex items-center justify-between">
                  <span>Players</span>
                  <span className="bg-slate-100 text-slate-400 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-tighter">Live</span>
                </h4>
                <div className="space-y-4">
                  {(Object.values(room.players) as Player[]).map(p => (
                    <div key={p.id} className="flex items-center justify-between border-b border-slate-50 pb-3">
                      <div className="flex items-center gap-3 max-w-[70%]">
                        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-xs ${p.id === user.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {p.name[0].toUpperCase()}
                        </div>
                        <span className={`text-xs font-medium truncate ${p.id === user.id ? 'text-indigo-600 font-bold' : ''}`} title={p.name}>
                            {p.name} {p.id === user.id && '(You)'}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-sm text-indigo-700 flex-shrink-0">{p.totalScore}</span>
                    </div>
                  ))}
                </div>
              </div>

              {(room.phase === GamePhase.VALIDATION || room.phase === GamePhase.FINISHED) && (
                <div className="bg-indigo-900 rounded-3xl p-6 text-white shadow-xl">
                  <h4 className="font-bold mb-4 flex items-center gap-2">
                    <span className="text-xl">🏆</span> Leaderboard
                  </h4>
                  <div className="space-y-3">
                    {(Object.values(room.players) as Player[])
                      .sort((a, b) => b.totalScore - a.totalScore)
                      .map((p, idx) => (
                        <div key={p.id} className="flex items-center justify-between bg-white/10 px-4 py-2 rounded-xl">
                          <span className="text-xs font-semibold opacity-80 truncate max-w-[70%]" title={p.name}>{idx + 1}. {p.name}</span>
                          <span className="font-bold text-sm flex-shrink-0">{p.totalScore} pts</span>
                        </div>
                      ))}
                  </div>

                  {user.id === room.hostId && (
                    <button 
                      onClick={handleRestart}
                      className="w-full mt-6 py-3 bg-white text-indigo-900 font-bold rounded-xl hover:bg-indigo-50 transition-all active:scale-95 shadow-lg border border-indigo-200"
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

      {(room.phase === GamePhase.SCORING || room.phase === GamePhase.VALIDATION) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 md:px-6 py-2 rounded-full shadow-2xl border border-slate-200 flex items-center gap-4 md:gap-6 z-20">
            <div className="flex items-center gap-1 md:gap-2">
                <span className="text-green-600 font-black text-lg md:text-xl">O</span>
                <span className="text-[10px] text-slate-500 font-bold">1pt</span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
                <span className="text-red-600 font-black text-lg md:text-xl">X</span>
                <span className="text-[10px] text-slate-500 font-bold">0pt</span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
                <span className="text-amber-500 text-lg md:text-xl">⭐</span>
                <span className="text-[10px] text-slate-500 font-bold">3pts</span>
            </div>
            <div className="w-[1px] h-4 bg-slate-200"></div>
            <span className="text-[8px] md:text-[10px] text-slate-400 font-medium uppercase italic hidden xs:block">Tap cell to score</span>
        </div>
      )}
    </div>
  );
};

export default App;
