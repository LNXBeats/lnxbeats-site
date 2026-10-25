export type StudioSceneMode = "hero" | "gallery";

export type StudioSceneStats = {
  available: boolean;
  renderer?: string;
  drawCalls?: number;
  triangles?: number;
  frames?: number;
  dpr?: number;
  width?: number;
  height?: number;
  texturesReady?: number;
  textureCache?: number;
  maxTextures?: number;
  maxTextureEdge?: number;
  textureStates?: string[];
  motion?: boolean;
  inView?: boolean;
  contextLost?: boolean;
  index?: number;
  running?: boolean;
  fpsLimit?: number;
  averageFrameMs?: number | null;
  averageCpuMs?: number | null;
  estimatedFps?: number | null;
  timingSamples?: number;
};

export interface StudioScene {
  setIndex(index: number): void;
  setMode(mode: StudioSceneMode): void;
  setMotion(enabled: boolean): void;
  setPointer(x: number, y: number): void;
  setScroll(progress: number): void;
  getStats(): StudioSceneStats;
  dispose(): void;
}

export interface StudioSceneOptions {
  covers: readonly string[];
  initialIndex?: number;
  mode?: StudioSceneMode;
  reducedMotion?: boolean;
  onReady?: (details: { renderer: string; artworkCount: number }) => void;
  onError?: (error: Error) => void;
}

export function studioCoverSource(value: unknown): string;
export function createStudioScene(canvas: HTMLCanvasElement, options: StudioSceneOptions): StudioScene;
