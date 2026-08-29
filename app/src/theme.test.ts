// @vitest-environment node
// The Evidence Console guards (specs/011-evidence-console): colour is defined once, in
// theme.css, from archify's vocabulary — and every machine kind resolves to one of the seven
// semantic tones the maps use.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MACHINES } from './machines/registry';
import { machineTone } from './archify/vocabulary';
import { applyTheme } from './state/settings';

const SRC = fileURLToPath(new URL('./', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'fixtures' ? [] : cssFiles(p);
    return f.endsWith('.css') ? [p] : [];
  });
}

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const TONES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];

describe('theme tokens (specs/011 AC-1, AC-2)', () => {
  it('no colour literal exists outside theme.css', () => {
    const offenders = cssFiles(SRC)
      .filter((p) => !p.endsWith('/theme.css'))
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => LITERAL.test(line))
          .map(({ i }) => `${p.slice(SRC.length)}:${i + 1}`),
      );
    expect(offenders).toEqual([]);
  });

  it('defines the seven semantic tones, their roles, and the light palette', () => {
    const css = readFileSync(join(SRC, 'theme.css'), 'utf8');
    for (const t of TONES) expect(css, t).toMatch(new RegExp(`--c-${t}:`));
    for (const role of [
      '--accent:',
      '--ok:',
      '--warn:',
      '--danger:',
      '--motion:',
      '--r-control:',
    ]) {
      expect(css).toContain(role);
    }
    expect(css).toMatch(/prefers-color-scheme: light/);
    expect(css).toMatch(/:root\[data-theme=["']light["']\]/);
    expect(css).toMatch(/:root:not\(\[data-theme=["']dark["']\]\)/);
  });

  it('every machine kind has a semantic tone the canvas and the maps share', () => {
    for (const m of MACHINES) {
      const tone = machineTone(m.type);
      expect(
        TONES.map((t) => `c-${t}`),
        m.type,
      ).toContain(tone);
    }
  });

  it('applyTheme stamps dark/light and clears for system (AC-3)', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
