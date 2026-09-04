import { C } from '../../constants/theme.js';
import { STAGES } from '../../constants/app.js';

export function StageRail({ status, t }) {
  const idx = STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: i <= idx ? C.blue : C.line }}
          />
          {i < STAGES.length - 1 && (
            <div
              className="h-px w-4"
              style={{ backgroundColor: i < idx ? C.blue : C.line }}
            />
          )}
        </div>
      ))}
      <span className="ml-1 text-xs" style={{ color: C.sub }}>
        {t.stage[status]}
      </span>
    </div>
  );
}
