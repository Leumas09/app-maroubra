// Graphique plus large que l'écran (téléphone) : on ouvre la vue centrée sur ce qui compte,
// au lieu du bord gauche. Le défilement reste libre.
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function CenteredScroll({ focus, className, children }: { focus: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || done.current || el.scrollWidth <= el.clientWidth + 1) return;
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, focus * el.scrollWidth - el.clientWidth / 2));
    done.current = true;
  });
  return <div ref={ref} className={className}>{children}</div>;
}
