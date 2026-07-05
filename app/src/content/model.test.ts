import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  defaultConfig,
  parseConfig,
  serializeConfig,
  parseBacklog,
  serializeBacklog,
  starvedKinds,
  type BacklogItem,
  type FactoryConfig,
} from './model';

describe('FactoryConfig parse/serialize', () => {
  it('round-trips a full config incl. skills, criteria, docs settings', () => {
    const cfg: FactoryConfig = {
      model: 'claude-sonnet-4-6',
      maxDailyRuns: 6,
      brandVoice: 'wry, concise',
      contentPaths: ['a/**', 'b/**'],
      docsDir: 'content/docs',
      itemsPerRun: 5,
      reviewCriteria: ['accuracy', 'clarity'],
      skills: [{ id: 'tech', name: 'Technical Writer', focus: 'precision' }],
    };
    expect(parseConfig(serializeConfig(cfg))).toEqual(cfg);
  });

  it('fills missing/bad fields with defaults, never throws', () => {
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(': : not yaml :')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('model: x\nmaxDailyRuns: -3\nitemsPerRun: 0')).toMatchObject({
      model: 'x',
      maxDailyRuns: DEFAULT_CONFIG.maxDailyRuns,
      itemsPerRun: DEFAULT_CONFIG.itemsPerRun,
    });
    // a bare list is not a config object
    expect(parseConfig('- a\n- b')).toEqual(DEFAULT_CONFIG);
  });

  it('coerces a scalar contentPaths into a list', () => {
    expect(parseConfig('contentPaths: docs/**').contentPaths).toEqual(['docs/**']);
  });

  it('parses skills, drops nameless ones, and respects an explicit empty list', () => {
    const skills = parseConfig('skills:\n  - name: Reviewer\n    focus: correctness\n  - focus: no name here').skills;
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: 'reviewer-1', name: 'Reviewer', focus: 'correctness' });
    // an explicit empty list means "the user cleared their skills", not "use defaults"
    expect(parseConfig('skills: []').skills).toEqual([]);
    // absent key falls back to defaults
    expect(parseConfig('model: x').skills).toEqual(DEFAULT_CONFIG.skills);
  });

  it('defaultConfig() returns an independently-mutable copy', () => {
    const a = defaultConfig();
    a.skills.push({ id: 'z', name: 'Z', focus: 'z' });
    a.reviewCriteria.push('x');
    expect(defaultConfig().skills).toEqual(DEFAULT_CONFIG.skills);
    expect(defaultConfig().reviewCriteria).toEqual(DEFAULT_CONFIG.reviewCriteria);
  });
});

describe('backlog parse/serialize', () => {
  const items: BacklogItem[] = [
    { id: 'a-1', kind: 'post', title: 'A', brief: 'about a', priority: 'high', status: 'todo' },
    { id: 'b-2', kind: 'doc', title: 'B', brief: '', priority: 'normal', status: 'done' },
  ];

  it('round-trips items', () => {
    expect(parseBacklog(serializeBacklog(items))).toEqual(items);
  });

  it('tolerates a bare list, drops titleless rows, defaults bad enums', () => {
    const parsed = parseBacklog('- title: Only\n  priority: bogus\n  status: nope\n- kind: post\n  brief: no title here');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: 'Only', priority: 'normal', status: 'todo', kind: 'post' });
  });

  it('never throws on malformed yaml', () => {
    expect(parseBacklog(': : :')).toEqual([]);
  });

  it('starvedKinds flags kinds with no todo item', () => {
    expect(starvedKinds(items)).toEqual(['doc']); // doc's only item is done
    expect(starvedKinds([])).toEqual([]);
  });
});
