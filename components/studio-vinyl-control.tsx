export type StudioVinylControlState = "play" | "pause" | "replay" | "loading";

export function StudioVinylControl({
  state,
  className,
}: {
  state: StudioVinylControlState;
  className?: string;
}) {
  const stateIcon = state === "play"
    ? <path d="M21 18.25v11.5L30 24z" fill="currentColor" />
    : state === "pause"
      ? <path d="M19.75 18.25h3.5v11.5h-3.5zm5 0h3.5v11.5h-3.5z" fill="currentColor" />
      : state === "replay"
        ? <>
          <path d="M18.75 19.75v5h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          <path d="M19.25 24.25a6.75 6.75 0 1 0 2.1-4.9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </>
        : <path className="studio-vinyl-control__loading-track" d="M24 17.25a6.75 6.75 0 1 1-6.75 6.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />;

  return <svg
    className={`studio-vinyl-control studio-vinyl-control--${state}${className ? ` ${className}` : ""}`}
    viewBox="0 0 48 48"
    aria-hidden="true"
    focusable="false"
    data-studio-vinyl-state={state}
  >
    <g className="studio-vinyl-control__disc" fill="none" stroke="currentColor">
      <circle cx="24" cy="24" r="19" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="14.5" opacity=".42" strokeWidth=".75" />
      <circle cx="24" cy="24" r="10.5" opacity=".3" strokeWidth=".75" />
      <circle className="studio-vinyl-control__label" cx="24" cy="24" r="4.75" fill="currentColor" stroke="none" />
      <circle className="studio-vinyl-control__spindle" cx="24" cy="24" r="1" fill="currentColor" stroke="none" opacity=".45" />
    </g>
    <g className="studio-vinyl-control__state">{stateIcon}</g>
  </svg>;
}
