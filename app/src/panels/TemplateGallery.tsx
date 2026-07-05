import './templategallery.css';
import { TEMPLATES } from '../templates/catalog';
import { useFactoryStore } from '../state/store';

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const loadBlueprint = useFactoryStore((s) => s.loadBlueprint);

  const stamp = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    loadBlueprint(structuredClone(t.blueprint));
    onClose();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Template gallery">
      <div className="modal__panel modal__panel--wide">
        <div className="modal__head">
          <span className="modal__title">📐 Templates</span>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">
          <p className="modal__note">
            Stamping <b>replaces the current canvas</b> — Export first if you care (undo works too).
          </p>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <div key={t.id} className="tpl">
                <div className="tpl__head">
                  <span className="tpl__icon" aria-hidden>
                    {t.icon}
                  </span>
                  <span className="tpl__name">{t.name}</span>
                </div>
                <p className="tpl__blurb">{t.blurb}</p>
                <div className="tpl__foot">
                  <span className="tpl__count">
                    {t.blueprint.nodes.length} machines · {t.blueprint.edges.length} belts
                  </span>
                  <button type="button" className="btn btn--primary btn--small" onClick={() => stamp(t.id)}>
                    Stamp onto floor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
