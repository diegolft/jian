/** The two strokes of the brand: one wing alone, the pair in flight. */
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}
