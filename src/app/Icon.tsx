import type { ReactNode } from "react";

export type IconName =
  "grid" | "phone" | "laptop" | "plus" | "link" | "unlink" | "terminal" | "monitor";

const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M10 5h4M11 19h2" />
    </>
  ),
  laptop: <path d="M6 16V5h12v11M3 16h18l-1 3H4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  link: (
    <path d="M10 13.5a4 4 0 0 0 5.7 0l4-4a4 4 0 0 0-5.7-5.7L12 6m2 4.5a4 4 0 0 0-5.7 0l-4 4a4 4 0 0 0 5.7 5.7L12 18" />
  ),
  unlink: (
    <path d="m9 14-1 1a3 3 0 0 0 4 4l3-3a3 3 0 0 0 0-4m0-2 1-1a3 3 0 0 0-4-4L9 8a3 3 0 0 0 0 4M4 3l16 18" />
  ),
  terminal: <path d="m5 6 5 6-5 6m8 0h6" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
