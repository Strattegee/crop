/**
 * CROP's mark: Milos's design no. 8 (orange dots narrowing to one point), redrawn from his preview image on
 * 2 Nov for staging; replace with his final artwork when it arrives. Decorative: the word CROP beside it carries the name.
 */
const DOTS: [number, number, number, number][] = [
  [55.6, 8.3, 8, 5.5], [35.4, 23, 8.5, 6.5], [75.9, 23, 8.5, 6.5], [55.4, 40.2, 10, 8.5], [11.1, 40.6, 9.5, 8],
  [99.9, 40.3, 9.5, 8], [30.5, 61.7, 11, 10], [80.2, 61.9, 10.5, 10.5], [55.5, 89.4, 12, 13],
];

export function BrandMark({ size = 28, colour = '#F26B1D' }: { size?: number; colour?: string }) {
  return (
    <svg className="brand-mark" width={size} height={Math.round((size * 104) / 112)} viewBox="0 0 112 104" aria-hidden="true" focusable="false">
      {DOTS.map(([cx, cy, rx, ry], i) => <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={colour} />)}
    </svg>
  );
}
