type LinkIconProps = {
  className?: string;
};

export function ExternalLinkIcon({ className = "link-icon" }: LinkIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 3.5h6.5V10" />
      <path d="m12.25 3.75-8.5 8.5" />
      <path d="M7.25 5H3.5v7.5H11V8.75" />
    </svg>
  );
}

export function ArrowLeftIcon({ className = "link-icon" }: LinkIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6.5 3.5-4.5 4.5 4.5 4.5" />
      <path d="M2.5 8H14" />
    </svg>
  );
}
