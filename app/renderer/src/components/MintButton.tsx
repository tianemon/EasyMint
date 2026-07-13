interface MintButtonProps {
  projectPath: string;
  onClick: () => void;
}

export function MintButton({ onClick }: MintButtonProps): JSX.Element {
  return (
    <div className="shrink-0 px-3 pb-2 flex flex-col items-center">
      <button
        onClick={onClick}
        className="w-full h-12 rounded-xl bg-accent-bg hover:bg-accent-border border border-accent-border-strong flex items-center justify-center transition-colors group"
      >
        <span className="mint-shimmer text-2xl select-none group-hover:scale-105 transition-transform tracking-[0.125em]">Mint</span>
      </button>
    </div>
  );
}
