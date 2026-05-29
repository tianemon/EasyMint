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
      className={`cursor-col-resize transition-colors shrink-0 ${
        dragging ? "bg-accent" : "bg-transparent hover:bg-accent/40"
      }`}
      style={{ width: 4 }}
      onMouseDown={onMouseDown}
    />
  );
}
