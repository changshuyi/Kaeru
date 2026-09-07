import { C } from '../../constants/theme.js';

export function Highlight({ text, match }) {
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.idx)}
      <span style={{ color: C.blueDeep, fontWeight: 700, borderBottom: `1px solid ${C.blue}` }}>
        {text.slice(match.idx, match.idx + match.len)}
      </span>
      {text.slice(match.idx + match.len)}
    </>
  );
}
