import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { syntaxTree } from '@codemirror/language';
import { Diagnostic, linter, lintGutter } from '@codemirror/lint';
import { MergeView } from '@codemirror/merge';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { checkTemplate } from '../core/engine/render';

export type Lang = 'html' | 'css' | 'js' | 'json' | 'text';

export function langFor(path: string): Lang {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs' || ext === 'ts') return 'js';
  if (ext === 'json') return 'json';
  return 'text';
}

function language(lang: Lang): Extension {
  switch (lang) {
    case 'html':
      return html();
    case 'css':
      return css();
    case 'js':
      return javascript();
    case 'json':
      return json();
    default:
      return [];
  }
}

/** Offset of the start of a 1-based line. */
function lineStart(doc: string, line: number): number {
  let pos = 0;
  for (let i = 1; i < line; i++) {
    const next = doc.indexOf('\n', pos);
    if (next < 0) return doc.length;
    pos = next + 1;
  }
  return pos;
}

/**
 * Syntax problems for a file: JSON parse errors, template-language errors for
 * component templates, and parser error nodes for CSS/JS/HTML.
 */
export function findProblems(path: string, doc: string, view?: EditorView): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lang = langFor(path);
  if (lang === 'json') {
    try {
      JSON.parse(doc);
    } catch (e) {
      const msg = (e as Error).message;
      // Browsers report either "at position N" or "at line L column C".
      const position = /position (\d+)/.exec(msg);
      const lineCol = /line (\d+) column (\d+)/.exec(msg);
      const pos = position ? Number(position[1]) : lineCol ? lineStart(doc, Number(lineCol[1])) + Number(lineCol[2]) - 1 : 0;
      out.push({ from: Math.min(pos, doc.length), to: Math.min(pos + 1, doc.length), severity: 'error', message: msg });
    }
    return out;
  }
  if (lang === 'html' && /(^|\/)component\.html$/.test(path)) {
    const err = checkTemplate(doc);
    if (err) {
      const from = lineStart(doc, err.line);
      out.push({ from, to: Math.min(doc.length, doc.indexOf('\n', from) < 0 ? doc.length : doc.indexOf('\n', from)), severity: 'error', message: err.message });
    }
  }
  if (view && (lang === 'css' || lang === 'js')) {
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.type.isError && out.length < 50) {
          out.push({ from: node.from, to: Math.max(node.to, node.from + 1), severity: 'error', message: `Syntax error in ${lang.toUpperCase()}` });
        }
      },
    });
  }
  return out;
}

/** Editor state for one file (each open tab keeps its own, including undo history). */
export function createFileState(
  path: string,
  doc: string,
  handlers: { onChange: (doc: string) => void; onSave: () => void; onProblems: (d: Diagnostic[]) => void },
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      language(langFor(path)),
      lintGutter(),
      linter(
        (v) => {
          const problems = findProblems(path, v.state.doc.toString(), v);
          handlers.onProblems(problems);
          return problems;
        },
        { delay: 300 },
      ),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (handlers.onSave(), true) }]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) handlers.onChange(u.state.doc.toString());
      }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: '13px' } }),
    ],
  });
}

/** Side-by-side diff. `a` is read-only (e.g. the version on disk); `b` is editable when `editableB`. */
export function createMergeView(parent: HTMLElement, opts: { path: string; a: string; b: string; editableB?: boolean }): MergeView {
  const common = [basicSetup, language(langFor(opts.path)), EditorView.theme({ '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: '12.5px' } })];
  return new MergeView({
    parent,
    a: { doc: opts.a, extensions: [...common, EditorState.readOnly.of(true)] },
    b: { doc: opts.b, extensions: [...common, EditorState.readOnly.of(!opts.editableB)] },
    collapseUnchanged: { margin: 3, minSize: 6 },
    highlightChanges: true,
    gutter: true,
  });
}
