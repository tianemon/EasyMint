/** 环境背景预设选择：只影响 AmbientBackground 的色相强度，不写入业务数据。 */
export type BackgroundPreset = 'mint' | 'blue' | 'neutral';

const PRESETS: Array<{ value: BackgroundPreset; label: string }> = [
  { value: 'mint', label: '薄荷' },
  { value: 'blue', label: '晴空' },
  { value: 'neutral', label: '中性' },
];

export function BackgroundPills({ value, onChange }: {
  value: BackgroundPreset;
  onChange: (value: BackgroundPreset) => void;
}): React.ReactElement {
  return (
    <div className="background-pills">
      {PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          className={`chip${value === preset.value ? ' is-selected' : ''}`}
          onClick={() => onChange(preset.value)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
