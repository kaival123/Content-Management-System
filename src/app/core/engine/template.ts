/**
 * A small Handlebars-style template language for section components
 * (site/components/<Name>/component.html).
 *
 *   {{ path }}                 escaped value            {{ heading }}, {{ item.title }}, {{ ../heading }}
 *   {{{ path }}}               raw HTML (sanitised)     {{{ data.html }}}
 *   {{ helper arg "lit" 3 }}   helper call              {{ color background }}, {{ default gap 32 }}
 *   {{#each list}}…{{else}}…{{/each}}                   loop; @index, @first, @last, this
 *   {{#if x}}…{{else}}…{{/if}}  {{#unless x}}…{{/unless}}
 *   {{#is value "literal"}}…{{else}}…{{/is}}            equality
 *   {{#with x}}…{{/with}}  or  {{#helper args}}…{{/helper}}  renders the body with the result as `this` when truthy
 *   {{!-- comment --}}
 *   @editor                    true inside the visual editor
 *
 * Output is a plain string, so the engine runs anywhere (browser, tests, static export).
 */

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
  }
}

type Arg = { kind: 'path'; path: string } | { kind: 'lit'; value: unknown };

interface Expr {
  helper: string | null;
  args: Arg[];
}

type Node =
  | { t: 'text'; v: string; hasEl: boolean }
  | { t: 'var'; expr: Expr; raw: boolean; line: number }
  | { t: 'block'; name: string; expr: Expr; body: Node[]; inverse: Node[]; line: number };

export type Helper = (...args: any[]) => unknown;

export interface TemplateOptions {
  helpers: Record<string, Helper>;
  /** Variables available as @name (e.g. @editor). */
  vars: Record<string, unknown>;
  /** Used for {{{ triple-stash }}} output. */
  sanitizeHtml: (html: string) => string;
}

export interface CompiledTemplate {
  render(context: unknown, options: TemplateOptions): string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function parseArgs(source: string): Arg[] {
  const args: Arg[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1] !== undefined || m[2] !== undefined) args.push({ kind: 'lit', value: m[1] ?? m[2] });
    else if (/^-?\d+(\.\d+)?$/.test(m[3])) args.push({ kind: 'lit', value: Number(m[3]) });
    else if (m[3] === 'true' || m[3] === 'false') args.push({ kind: 'lit', value: m[3] === 'true' });
    else if (m[3] === 'null') args.push({ kind: 'lit', value: null });
    else args.push({ kind: 'path', path: m[3] });
  }
  return args;
}

/** A single token is a value lookup; several tokens are a helper call. */
function parseExpr(source: string): Expr {
  const args = parseArgs(source.trim());
  if (args.length > 1 && args[0].kind === 'path') return { helper: args[0].path, args: args.slice(1) };
  return { helper: null, args };
}

export function compile(src: string): CompiledTemplate {
  const root: Node[] = [];
  const stack: { name: string; node: Extract<Node, { t: 'block' }>; inElse: boolean; line: number }[] = [];
  const target = () => {
    const top = stack.at(-1);
    return top ? (top.inElse ? top.node.inverse : top.node.body) : root;
  };

  const tagRe = /\{\{(\{)?\s*([\s\S]*?)\s*\}?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    if (m.index > last) {
      const v = src.slice(last, m.index);
      target().push({ t: 'text', v, hasEl: v.includes('data-el="') });
    }
    last = tagRe.lastIndex;
    const line = lineAt(src, m.index);
    const raw = !!m[1];
    const body = m[2];

    if (body.startsWith('!')) continue; // comment
    if (body.startsWith('#')) {
      const space = body.search(/\s/);
      const name = space < 0 ? body.slice(1) : body.slice(1, space);
      const exprSrc = space < 0 ? '' : body.slice(space + 1);
      if (!name) throw new TemplateError('Block is missing a name', line);
      const args = parseArgs(exprSrc);
      const node: Extract<Node, { t: 'block' }> = { t: 'block', name, expr: { helper: null, args }, body: [], inverse: [], line };
      target().push(node);
      stack.push({ name, node, inElse: false, line });
      continue;
    }
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top) throw new TemplateError(`Unexpected {{/${name}}} with no open block`, line);
      if (top.name !== name) throw new TemplateError(`{{/${name}}} closes {{#${top.name}}} opened on line ${top.line}`, line);
      continue;
    }
    if (body === 'else') {
      const top = stack.at(-1);
      if (!top) throw new TemplateError('{{else}} outside of a block', line);
      if (top.inElse) throw new TemplateError(`Second {{else}} in {{#${top.name}}}`, line);
      top.inElse = true;
      continue;
    }
    if (!body) throw new TemplateError('Empty {{ }} tag', line);
    target().push({ t: 'var', expr: parseExpr(body), raw, line });
  }
  if (last < src.length) {
    const v = src.slice(last);
    target().push({ t: 'text', v, hasEl: v.includes('data-el="') });
  }
  const open = stack.at(-1);
  if (open) throw new TemplateError(`{{#${open.name}}} is never closed`, open.line);

  return { render: (context, options) => renderNodes(root, [{ ctx: context }], options) };
}

interface Frame {
  ctx: any;
  index?: number;
  first?: boolean;
  last?: boolean;
}

function lookup(path: string, frames: Frame[], options: TemplateOptions): unknown {
  if (path.startsWith('@')) {
    const loop = [...frames].reverse().find((f) => f.index !== undefined);
    if (path === '@index') return loop?.index;
    if (path === '@first') return loop?.first;
    if (path === '@last') return loop?.last;
    if (path.startsWith('@root')) return dig(frames[0].ctx, path.slice(5).replace(/^\./, ''));
    return options.vars[path.slice(1)];
  }
  let depth = frames.length - 1;
  let rest = path;
  while (rest.startsWith('../')) {
    depth = Math.max(0, depth - 1);
    rest = rest.slice(3);
  }
  const ctx = frames[depth].ctx;
  if (rest === 'this' || rest === '.') return ctx;
  return dig(ctx, rest.replace(/^this\./, ''));
}

function dig(obj: any, path: string): unknown {
  if (!path) return obj;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function argValue(arg: Arg, frames: Frame[], options: TemplateOptions): unknown {
  return arg.kind === 'lit' ? arg.value : lookup(arg.path, frames, options);
}

function evalExpr(expr: Expr, frames: Frame[], options: TemplateOptions, line: number): unknown {
  const values = expr.args.map((a) => argValue(a, frames, options));
  if (!expr.helper) return values[0];
  const helper = options.helpers[expr.helper];
  if (!helper) throw new TemplateError(`Unknown helper "${expr.helper}"`, line);
  return helper(...values);
}

function truthy(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v;
}

/** Inside loops, tag repeated elements with their item index so the editor knows which item was clicked. */
function withIndex(text: string, frames: Frame[]): string {
  const loop = [...frames].reverse().find((f) => f.index !== undefined);
  return loop ? text.replace(/data-el="/g, `data-index="${loop.index}" data-el="`) : text;
}

function renderNodes(nodes: Node[], frames: Frame[], options: TemplateOptions): string {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text') {
      out += node.hasEl ? withIndex(node.v, frames) : node.v;
      continue;
    }
    if (node.t === 'var') {
      const v = evalExpr(node.expr, frames, options, node.line);
      out += node.raw ? options.sanitizeHtml(v === undefined || v === null ? '' : String(v)) : escapeHtml(v);
      continue;
    }
    const args = node.expr.args.map((a) => argValue(a, frames, options));
    switch (node.name) {
      case 'each': {
        const list = args[0];
        const items = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list) : [];
        if (!items.length) {
          out += renderNodes(node.inverse, frames, options);
          break;
        }
        items.forEach((item, index) => {
          out += renderNodes(node.body, [...frames, { ctx: item, index, first: index === 0, last: index === items.length - 1 }], options);
        });
        break;
      }
      case 'if':
        out += renderNodes(truthy(args[0]) ? node.body : node.inverse, frames, options);
        break;
      case 'unless':
        out += renderNodes(truthy(args[0]) ? node.inverse : node.body, frames, options);
        break;
      case 'is':
        out += renderNodes(String(args[0] ?? '') === String(args[1] ?? '') ? node.body : node.inverse, frames, options);
        break;
      case 'with':
        out += truthy(args[0]) ? renderNodes(node.body, [...frames, { ctx: args[0] }], options) : renderNodes(node.inverse, frames, options);
        break;
      default: {
        const helper = options.helpers[node.name];
        if (!helper) throw new TemplateError(`Unknown block helper "#${node.name}"`, node.line);
        const v = helper(...args);
        out += truthy(v) ? renderNodes(node.body, [...frames, { ctx: v }], options) : renderNodes(node.inverse, frames, options);
      }
    }
  }
  return out;
}

// --- Start-tag post-processing ---------------------------------------------------------

export type Attrs = Map<string, string | null>;

const START_TAG = /<([a-zA-Z][\w-]*)((?:\s+(?:[^\s>"'=/]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s>"'=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Calls `visit` for every start tag, letting it add or change attributes. Attribute
 * values are passed and returned HTML-escaped, exactly as they appear in the markup.
 */
export function rewriteTags(html: string, visit: (tag: string, attrs: Attrs) => boolean): string {
  return html.replace(START_TAG, (whole, tag: string, attrSrc: string, selfClose: string) => {
    const attrs: Attrs = new Map();
    let m: RegExpExecArray | null;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(attrSrc ?? ''))) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? null);
    if (!visit(tag.toLowerCase(), attrs)) return whole;
    let out = `<${tag}`;
    for (const [name, value] of attrs) out += value === null ? ` ${name}` : ` ${name}="${value}"`;
    return out + (selfClose ? ' />' : '>');
  });
}

/** Decodes the few entities that matter for recognising URL schemes. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** True for javascript:/vbscript:/data: URLs (except data:image for src). */
export function isUnsafeUrl(value: string, allowDataImage: boolean): boolean {
  const v = decodeEntities(value).replace(/[\u0000- ]/g, '').toLowerCase();
  if (/^(javascript|vbscript):/.test(v)) return true;
  if (v.startsWith('data:')) return !(allowDataImage && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/.test(v));
  return false;
}
