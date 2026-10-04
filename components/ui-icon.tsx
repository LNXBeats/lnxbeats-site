import type { SVGProps } from "react";

const paths = {
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  "arrow-left": "M20 12H4m6-6-6 6 6 6",
  "arrow-up-right": "M5 19 19 5M5 5h14v14",
  "chevron-right": "m9 5 7 7-7 7",
  play: "m8 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  headphones: "M4 14v-2a8 8 0 0 1 16 0v2M4 12H2v8h5v-8H4Zm16 0h2v8h-5v-8h3Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  pen: "m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15l-1 7Z",
  user: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2ZM16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  disc: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 10a7 7 0 0 1 5-5m4 14a7 7 0 0 0 5-5",
  music: "M9 18V5l12-3v13M9 9l12-3M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  bag: "M5 7h14l2 14H3ZM8 8V6a4 4 0 0 1 8 0v2",
  mail: "M3 5h18v14H3ZM3 6l9 7 9-7",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6m0-10v.1",
  close: "m6 6 12 12M18 6 6 18",
  volume: "M11 4 6 8H2v8h4l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  previous: "M5 5v14m14 0L8 12l11-7Z",
  next: "M19 5v14M5 19l11-7L5 5Z",
} as const;

export type UiIconName = keyof typeof paths;

/** Decorative only: the enclosing link/button supplies its accessible name. */
export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: UiIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]} /></svg>;
}
