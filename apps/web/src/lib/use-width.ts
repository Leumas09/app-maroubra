// Largeur réelle d'un bloc, en pixels : les graphiques se dessinent à cette largeur au lieu d'être
// réduits (textes illisibles) ou de déborder dans un ascenseur.
import { useLayoutEffect, useState, type RefObject } from "react";

export function useWidth(ref: RefObject<Element>, fallback: number): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w || fallback;
}
