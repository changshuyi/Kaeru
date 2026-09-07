import { C } from '../../constants/theme.js';

/* 票券：四方角、細框、上緣虛線裁切 */
/* 一組（同店同日）收據共用一個外框，票券感只靠內部虛線分隔——見 ListView 的呼叫方式 */
export function Ticket({ children, tone = 'normal', onClick, separator }) {
  const bg = tone === 'dead' ? C.soft : '#FFFFFF';
  const El = onClick ? 'button' : 'div';
  return (
    <El
      onClick={onClick}
      className="relative block w-full px-3.5 pb-3.5 pt-3 text-left"
      style={{
        backgroundColor: bg,
        borderTop: separator ? `1px dashed ${C.line}` : 'none',
        borderRadius: 0,
      }}
    >
      {children}
    </El>
  );
}
