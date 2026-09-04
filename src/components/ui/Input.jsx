import { C } from '../../constants/theme.js';

/* 底線式輸入：無框、無底色，focus 時底線轉 ink（見 App 頂層的 .jp-underline 樣式） */
export function Input(props) {
  return (
    <input
      {...props}
      className="jp-underline w-full bg-transparent outline-none"
      style={{
        border: 'none',
        borderBottom: `1px solid ${C.line}`,
        color: C.ink,
        padding: '0 0 10px',
        fontSize: '16px',
      }}
    />
  );
}
