import type { SVGProps } from "react";

export type AdminIconName = "home" | "music" | "shop" | "users" | "settings" | "tools" | "search" | "bell" | "file" | "box" | "heart" | "link" | "video" | "audio" | "check" | "alert" | "arrow";

const paths: Record<AdminIconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-8h6v8" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  shop: <><path d="M3 9h18l-2 12H5zM5 9l1-6h12l1 6" /><path d="M9 13v3m6-3v3" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3Zm13-15a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5h-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m10 2-.5 2.2-2 1-2-.9-2 3.4 1.5 1.7-.2 2.2L3 13l1.4 3.7 2.2.1 1.5 1.6-.2 2.2 3.8.4 1-2 2.1-.7 1.9 1.2 2.6-2.7-1.1-2 .8-2 2-.9-.4-3.8-2.2-.3-1.5-1.6.1-2.2L13.2 2 12 4z" /></>,
  tools: <><path d="M4 20v-7m0-4V4m8 16v-4m0-4V4m8 16v-9m0-4V4" /><circle cx="4" cy="11" r="2" /><circle cx="12" cy="14" r="2" /><circle cx="20" cy="9" r="2" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12a2 2 0 0 0 4 0" /></>,
  file: <><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h8" /></>,
  box: <><path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4m-9 4v10" /></>,
  heart: <path d="M20 5a5 5 0 0 0-7 0l-1 1-1-1a5 5 0 0 0-7 7l8 9 8-9a5 5 0 0 0 0-7Z" />,
  link: <><path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2" /></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
  audio: <><path d="M4 9v6m4-10v14m4-17v20m4-14v8m4-5v2" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  alert: <><path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v.1" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
};

export function AdminIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: AdminIconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false" {...props}>{paths[name]}</svg>;
}
