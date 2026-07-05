// PLACEHOLDER — the blueprint template gallery is implemented by the machines/templates
// workstream. Contract: named export; `onClose` dismisses the overlay; stamping a template
// loads it into the factory store.

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Template gallery">
      <div className="modal__panel">
        <div className="modal__head">
          <span className="modal__title">📐 Templates</span>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">
          <p className="modal__note">Template gallery is coming online…</p>
        </div>
      </div>
    </div>
  );
}
