import { createSection } from '../section-registry';
import { loadSiteComponents } from '../site.test-helpers';
import { ComponentDef, renderSection } from './render';
import { TemplateError, compile, escapeHtml } from './template';

const opts = (editor = false) => ({ editor, assetBase: '/site/', sanitizeHtml: (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, '') });

describe('template engine', () => {
  const render = (src: string, ctx: unknown, vars: Record<string, unknown> = {}) =>
    compile(src).render(ctx, { helpers: { up: (s: string) => s.toUpperCase() }, vars, sanitizeHtml: (h) => h });

  it('escapes values and supports blocks', () => {
    expect(render('<b>{{ name }}</b>', { name: '<x>' })).toBe('<b>&lt;x&gt;</b>');
    expect(render('{{#each a}}{{@index}}:{{this}} {{/each}}', { a: ['x', 'y'] })).toBe('0:x 1:y ');
    expect(render('{{#if a}}yes{{else}}no{{/if}}', { a: [] })).toBe('no');
    expect(render('{{#is t "h1"}}one{{else}}other{{/is}}', { t: 'h1' })).toBe('one');
    expect(render('{{#each items}}{{../title}}-{{name}}{{/each}}', { title: 'T', items: [{ name: 'n' }] })).toBe('T-n');
    expect(render('{{ up name }}', { name: 'ab' })).toBe('AB');
    expect(render('{{#if @editor}}E{{/if}}', {}, { editor: true })).toBe('E');
    expect(render('{{!-- hidden --}}ok', {})).toBe('ok');
  });

  it('adds item indexes to repeated elements', () => {
    expect(render('{{#each a}}<i data-el="x"></i>{{/each}}', { a: [1, 2] })).toBe('<i data-index="0" data-el="x"></i><i data-index="1" data-el="x"></i>');
  });

  it('reports template mistakes with line numbers', () => {
    expect(() => compile('<div>\n{{#if a}}\n</div>')).toThrow(TemplateError);
    expect(() => compile('{{#if a}}{{/each}}')).toThrow(/closes \{\{#if\}\}/);
    try {
      compile('a\nb\n{{/if}}');
    } catch (e) {
      expect((e as TemplateError).line).toBe(3);
    }
  });
});

describe('site components', () => {
  const components = loadSiteComponents();
  const byType = new Map(components.map((c) => [c.type, c]));

  it.each(components.map((c) => [c.folder, c.type]))('%s renders its default content', (_folder, type) => {
    const section = createSection(type as string);
    const html = renderSection(section, byType.get(type as string), opts());
    expect(html).not.toContain('lp-missing');
    expect(html).toContain(`data-section-id="${section.id}"`);
    expect(html).not.toContain('{{');
  });

  it('applies element styles, editing hooks and grid settings', () => {
    const s = createSection('features');
    s.elements = { title: { fontSize: 30, color: '__primary__' } };
    const html = renderSection(s, byType.get('features'), opts(true));
    expect(html).toMatch(/<h3 class="lp-h3 lp-el-fs" data-index="0" data-el="title" data-edit="title" style="--el-fs: 30px; color: var\(--lp-primary\)" contenteditable="plaintext-only"/);
    expect(html).toContain('lp-cards-bordered lp-text-left');
    expect(html).toContain('--cols-d: 3');
  });

  it('neutralises unsafe URLs and resolves project assets', () => {
    const s = createSection('hero', { primaryHref: 'javascript:alert(1)', image: 'assets/images/a.png', heading: '<img src=x onerror=alert(1)>' });
    const html = renderSection(s, byType.get('hero'), opts());
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="/site/assets/images/a.png"');
    expect(html).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
  });

  it('sanitises custom HTML elements', () => {
    const s = createSection('custom');
    s.data.columns[0].elements = [{ id: 'e1', type: 'html', data: { html: '<b>ok</b><script>alert(1)</script>' }, style: {} }];
    const html = renderSection(s, byType.get('custom'), opts());
    expect(html).toContain('<b>ok</b>');
    expect(html).not.toContain('<script');
  });

  it('gives each new custom section fresh element ids', () => {
    const a = createSection('custom');
    const b = createSection('custom');
    expect(a.data.columns[0].id).not.toBe(b.data.columns[0].id);
    expect(a.data.columns[0].elements[0].id).not.toBe(b.data.columns[0].elements[0].id);
  });
});

