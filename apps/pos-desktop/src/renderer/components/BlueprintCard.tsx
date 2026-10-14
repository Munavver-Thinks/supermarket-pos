import type { CSSProperties, ReactNode } from "react";

interface BlueprintCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A hairline-bordered card with the four registration-mark corners used throughout the design. */
export function BlueprintCard({ children, className, style }: BlueprintCardProps): JSX.Element {
  return (
    <div className={["blueprint", className].filter(Boolean).join(" ")} style={style}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </div>
  );
}
