export function PostelMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      role="img"
      aria-label="Postel"
      className={className}
    >
      <path
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M 6 9 L 6 23 L 14 16 Z M 26 9 L 26 23 L 18 16 Z"
      />
    </svg>
  );
}
