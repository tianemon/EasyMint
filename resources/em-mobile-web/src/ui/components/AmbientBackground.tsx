/** 环境层：整页底色 + 三团柔光（照 App AmbientBackground，无纹理层）。 */
export function AmbientBackground(): React.ReactElement {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-blob ambient-green" />
      <div className="ambient-blob ambient-blue" />
      <div className="ambient-blob ambient-cool" />
    </div>
  );
}
