/** A single left wing; the body and beak remain distinct at favicon size. */
export function Mark({ small = false, className = '' }: { small?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 104 104"
      fill="currentColor"
      className={`brand-mark ${small ? 'small' : ''} ${className}`}
      aria-hidden="true"
    >
      <path className="jian-wing" d="M8 9 53 27 72 49 58 62 33 51 18 34 48 48 12 22 54 40Z" />
      <path d="m42 95 7-28 10-12 13-18 12-4 14 8-14 4-9 19-14 12Z" />
    </svg>
  );
}
