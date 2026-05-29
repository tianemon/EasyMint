import { useState, useCallback, useEffect } from "react";

interface DragHandleProps {
  onDrag: (delta: number) => void;
}

export function DragHandle({ onDrag }: DragHandleProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setStartX(e.clientX);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      setStartX(e.clientX);
      onDrag(delta);
    };

    const onMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, startX, onDrag]);

  return (
    <div
      className={`cursor-col-resize shrink-0 relative z-10 select-none ${
        dragging ? "bg-accent" : "bg-transparent"
      }`}
      style={{ width: 4, transition: "background 150ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      onMouseDown={onMouseDown}
      onMouseEnter={(e) => { if (!dragging) (e.target as HTMLElement).style.background = "var(--color-accent)"; }}
      onMouseLeave={(e) => { if (!dragging) (e.target as HTMLElement).style.background = "transparent"; }}
    />
  );
}
