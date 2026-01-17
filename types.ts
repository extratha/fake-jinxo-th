
export enum GamePhase {
  LOBBY = 'LOBBY',
  SELECT_THEMES = 'SELECT_THEMES',
  WRITING = 'WRITING',
  SCORING = 'SCORING',
  VALIDATION = 'VALIDATION',
  FINISHED = 'FINISHED'
}

export type ScoreType = 'NONE' | 'O' | 'X' | 'STAR';

export interface GridCell {
  word: string;
  score: ScoreType;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  grid: GridCell[]; // 9 cells
  totalScore: number;
  isReady: boolean;
}

export interface GameRoom {
  id: string;
  hostId: string;
  themes: string[];
  phase: GamePhase;
  players: Record<string, Player>;
  createdAt: number;
}
