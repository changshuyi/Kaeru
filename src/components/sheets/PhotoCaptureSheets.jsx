import { X, ChevronRight } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { BottomSheet } from '../ui/BottomSheet.jsx';
import { PermissionPrimeSheet } from './PermissionPrimeSheet.jsx';
import { PhotoConfirmSheet } from './PhotoConfirmSheet.jsx';

export function PhotoCaptureSheets({ t, cap, onConfirmCancelled }) {
  return (
    <>
      {cap.primeOpen && (
        <PermissionPrimeSheet t={t} onAllow={cap.confirmPrime} onDecline={cap.declinePrime} />
      )}

      {cap.photoPromptOpen && (
        <BottomSheet onClose={() => cap.setPhotoPromptOpen(false)}>
          <div className="flex items-center justify-between">
            <h2 className="font-bold" style={{ fontSize: '18px' }}>
              {t.photo}
            </h2>
            <button onClick={() => cap.setPhotoPromptOpen(false)} style={{ color: C.sub }}>
              <X size={18} />
            </button>
          </div>
          <p className="mt-1.5" style={{ color: C.sub, fontSize: '11.5px' }}>
            {t.photoSheetSub}
          </p>
          <div className="mt-3">
            {[
              { label: t.takePhotoOption, hint: t.takePhotoHint, onClick: cap.openCamera },
              { label: t.chooseFromLibrary, hint: t.libraryHint, onClick: cap.openLibrary },
              { label: t.scanDoc, hint: t.scanDocHint, onClick: cap.openScan },
            ].map((opt, i) => (
              <button
                key={opt.label}
                onClick={opt.onClick}
                className="flex w-full items-center justify-between py-4 text-left"
                style={{ borderTop: `1px solid ${i === 0 ? C.ink : C.line}` }}
              >
                <span>
                  <span className="block font-bold" style={{ fontSize: '15px', color: C.ink }}>
                    {opt.label}
                  </span>
                  <span className="block" style={{ fontSize: '11.5px', color: C.sub }}>
                    {opt.hint}
                  </span>
                </span>
                <ChevronRight size={14} style={{ color: C.sub, flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-center py-3" style={{ borderTop: `1px solid ${C.ink}` }}>
            <button
              onClick={() => cap.setPhotoPromptOpen(false)}
              className="font-semibold"
              style={{ color: C.sub, fontSize: '13.5px' }}
            >
              {t.cancel}
            </button>
          </div>
        </BottomSheet>
      )}

      {cap.confirmPhoto && (
        <PhotoConfirmSheet
          t={t}
          src={cap.confirmPhoto.src}
          fromScan={cap.confirmPhoto.fromScan}
          onRetake={cap.retake}
          onUse={cap.finishConfirm}
          onClose={() => {
            cap.finishConfirm(null);
            if (onConfirmCancelled) onConfirmCancelled();
          }}
        />
      )}
    </>
  );
}
