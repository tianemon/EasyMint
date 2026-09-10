/** 用户消息文本：主聊天与子 Agent 过程视图共用同一规格——封顶 12 行、超出滚动、长串不撑宽。
 *  宽度钳制由调用方负责（两处容器层级与头像占位不同）。
 *  行数用 lh 单位表达，随 line-height 变化自动跟随（写死倍数会在改行高时静默失配）；
 *  +0.5px 抵消亚像素累积，恰好 12 行时不会误出滚动条。 */
export function UserMessageText({ text }: { text: string }): JSX.Element {
  return (
    <div
      className="whitespace-pre-wrap [overflow-wrap:anywhere] min-w-0 overflow-y-auto overscroll-contain"
      style={{ maxHeight: "calc(12lh + 0.5px)" }}
    >{text}</div>
  );
}
