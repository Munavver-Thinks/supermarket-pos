import { BlueprintCard } from "./BlueprintCard.js";
import { Icon, type IconName } from "./icons.js";

interface ComingSoonScreenProps {
  title: string;
  text: string;
  ctaLabel?: string;
  onCta?: () => void;
  /** The screen's own nav icon (e.g. "ai", "mobile", "help"); a neutral one when omitted. */
  icon?: IconName;
}

/** Honest "not built yet" placeholder — never render fabricated numbers or sample rows here. */
export function ComingSoonScreen({ title, text, ctaLabel, onCta, icon = "info" }: ComingSoonScreenProps): JSX.Element {
  return (
    <div className="screen-section">
      <BlueprintCard className="soon-card">
        <Icon name={icon} size={48} />
        <h2>{title}</h2>
        <p className="note">{text}</p>
        {ctaLabel && onCta && (
          <button className="btn btn-secondary" onClick={onCta}>
            {ctaLabel}
          </button>
        )}
      </BlueprintCard>
    </div>
  );
}
