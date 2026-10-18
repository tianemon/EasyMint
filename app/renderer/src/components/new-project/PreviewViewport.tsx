import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PreviewDevice } from "./style-presets";

/** Keep the simulated viewport stable; only its display size follows the window. */
export function PreviewViewport({ device, width, height, children }: { device: PreviewDevice; width: number; height: number; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => setSpace((current) => current.width === host.clientWidth && current.height === host.clientHeight ? current : { width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const mobile = device === "mobile";
  const scale = mobile ? Math.min(space.width / width, space.height / height) : 1;
  return <div ref={ref} className="creation-preview-stage"><div className="creation-device-display" style={mobile ? { width: width * scale, height: height * scale, visibility: scale ? "visible" : "hidden" } : undefined}><div className="creation-device-frame" data-device={device} style={mobile ? { position: "absolute", width, height, left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "0 0" } : undefined}>{children}</div></div></div>;
}
