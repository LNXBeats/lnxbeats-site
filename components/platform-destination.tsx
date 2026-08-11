import Image from "next/image";

type PlatformDestinationProps = {
  index: string;
  name: string;
  label: string;
  action: string;
  url: string;
  tone: "spotify" | "apple" | "deezer" | "amazon" | "youtube" | "tiktok" | "instagram";
  logo?: {
    src: string;
    width: number;
    height: number;
  };
};

export function PlatformDestination({ index, name, label, action, url, tone, logo }: PlatformDestinationProps) {
  return (
    <a
      className={`platform-destination platform-destination--${tone}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${action} — nouvel onglet`}
    >
      <span className="platform-destination__index" aria-hidden="true">{index}</span>
      <span className="platform-destination__brand">
        {logo ? (
          <>
            <Image src={logo.src} alt="" width={logo.width} height={logo.height} sizes="220px" />
            <span className="visually-hidden">{name}</span>
          </>
        ) : (
          <strong>{name}</strong>
        )}
      </span>
      <span className="platform-destination__copy">{label}</span>
      <span className="platform-destination__action" aria-hidden="true">{action} <b>↗</b></span>
    </a>
  );
}
