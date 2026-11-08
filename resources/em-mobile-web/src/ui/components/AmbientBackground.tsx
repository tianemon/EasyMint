/** 环境层：让玻璃能透出「有东西」的背景，纯色底会让材质退化成半透明块。 */
export function AmbientBackground(): React.ReactElement {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-blob ambient-green" />
      <div className="ambient-blob ambient-blue" />
      <div className="ambient-blob ambient-cool" />
      <div className="ambient-grain" />
    </div>
  );
}
