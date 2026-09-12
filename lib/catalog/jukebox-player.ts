export type JukeboxPlayerState = Readonly<{
  selectedSlug: string;
  playingSlug: string | null;
}>;

export type JukeboxPlayerAction =
  | Readonly<{ type: "select"; slug: string }>
  | Readonly<{ type: "play"; slug: string }>
  | Readonly<{ type: "pause"; slug: string }>
  | Readonly<{ type: "stop" }>;

export function initialJukeboxPlayerState(selectedSlug: string): JukeboxPlayerState {
  return { selectedSlug, playingSlug: null };
}

export function reduceJukeboxPlayerState(
  state: JukeboxPlayerState,
  action: JukeboxPlayerAction,
): JukeboxPlayerState {
  if (action.type === "select") {
    if (action.slug === state.selectedSlug) return state;
    return { ...state, selectedSlug: action.slug };
  }

  if (action.type === "play") {
    if (action.slug === state.playingSlug) return state;
    return { ...state, playingSlug: action.slug };
  }

  if (action.type === "pause") {
    if (state.playingSlug !== action.slug) return state;
    return { ...state, playingSlug: null };
  }

  if (state.playingSlug === null) return state;
  return { ...state, playingSlug: null };
}

export function jukeboxPlayerMetadataSlug(state: JukeboxPlayerState) {
  return state.playingSlug ?? state.selectedSlug;
}
