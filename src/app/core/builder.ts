import { BuilderColumn, BuilderElement, BuilderElementType, CustomSectionData, ElementKind, FieldDef } from './models';
import { uid } from './util';

/** Definition of an element that can be added to a custom section. */
export interface BuilderElementDef {
  type: BuilderElementType;
  label: string;
  icon: string;
  kind: ElementKind;
  fields: FieldDef[];
  /** Field written by inline editing on the canvas. */
  inline?: string;
  defaults: () => any;
}

export const BUILDER_ELEMENTS: BuilderElementDef[] = [
  {
    type: 'heading',
    label: 'Heading',
    icon: 'heading',
    kind: 'text',
    inline: 'text',
    fields: [
      { key: 'text', label: 'Text', type: 'textarea' },
      {
        key: 'level',
        label: 'Size / level',
        type: 'select',
        options: [
          { label: 'H1 – Page title', value: 'h1' },
          { label: 'H2 – Section title', value: 'h2' },
          { label: 'H3 – Subtitle', value: 'h3' },
          { label: 'H4 – Small title', value: 'h4' },
        ],
      },
    ],
    defaults: () => ({ text: 'Your heading here', level: 'h2' }),
  },
  {
    type: 'text',
    label: 'Text',
    icon: 'text',
    kind: 'text',
    inline: 'text',
    fields: [{ key: 'text', label: 'Text', type: 'textarea' }],
    defaults: () => ({ text: 'Write something that helps visitors understand your offer. Click to edit this text directly on the page.' }),
  },
  {
    type: 'image',
    label: 'Image',
    icon: 'image',
    kind: 'image',
    fields: [
      { key: 'src', label: 'Image', type: 'image' },
      { key: 'alt', label: 'Alt text (for accessibility and SEO)', type: 'text' },
      { key: 'href', label: 'Link (optional)', type: 'url' },
      { key: 'caption', label: 'Caption', type: 'text' },
    ],
    defaults: () => ({ src: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80', alt: '', href: '', caption: '' }),
  },
  {
    type: 'button',
    label: 'Button',
    icon: 'button',
    kind: 'button',
    inline: 'label',
    fields: [
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'href', label: 'Link', type: 'url', placeholder: 'https:// or #section' },
      {
        key: 'variant',
        label: 'Style',
        type: 'select',
        options: [
          { label: 'Solid', value: 'primary' },
          { label: 'Outline', value: 'ghost' },
          { label: 'Light', value: 'invert' },
          { label: 'Text link', value: 'link' },
        ],
      },
      { key: 'newTab', label: 'Open in a new tab', type: 'toggle' },
    ],
    defaults: () => ({ label: 'Get started', href: '#', variant: 'primary', newTab: false }),
  },
  {
    type: 'list',
    label: 'Checklist',
    icon: 'list',
    kind: 'text',
    fields: [
      { key: 'items', label: 'Items (one per line)', type: 'lines' },
      { key: 'marker', label: 'Bullet symbol', type: 'text', placeholder: '✓' },
    ],
    defaults: () => ({ items: ['First benefit', 'Second benefit', 'Third benefit'], marker: '✓' }),
  },
  {
    type: 'icon',
    label: 'Icon / emoji',
    icon: 'smile',
    kind: 'box',
    fields: [
      { key: 'icon', label: 'Emoji or symbol', type: 'text' },
      { key: 'size', label: 'Size (px)', type: 'number' },
    ],
    defaults: () => ({ icon: '🚀', size: 40 }),
  },
  {
    type: 'video',
    label: 'Video',
    icon: 'video',
    kind: 'image',
    fields: [{ key: 'url', label: 'YouTube or Vimeo link', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…' }],
    defaults: () => ({ url: '' }),
  },
  {
    type: 'spacer',
    label: 'Spacer',
    icon: 'spacer',
    kind: 'box',
    fields: [{ key: 'height', label: 'Height (px)', type: 'number' }],
    defaults: () => ({ height: 40 }),
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: 'minus',
    kind: 'box',
    fields: [
      { key: 'thickness', label: 'Thickness (px)', type: 'number' },
      { key: 'color', label: 'Colour', type: 'color' },
      { key: 'width', label: 'Width (%)', type: 'number' },
    ],
    defaults: () => ({ thickness: 1, color: '', width: 100 }),
  },
  {
    type: 'html',
    label: 'Custom HTML',
    icon: 'code',
    kind: 'box',
    fields: [{ key: 'html', label: 'HTML (scripts and unsafe tags are removed)', type: 'textarea' }],
    defaults: () => ({ html: '<p><strong>Custom HTML</strong> — add your own markup here.</p>' }),
  },
];

const ELEMENT_MAP = new Map(BUILDER_ELEMENTS.map((d) => [d.type, d]));

export function getBuilderElementDef(type: BuilderElementType): BuilderElementDef {
  return ELEMENT_MAP.get(type) ?? BUILDER_ELEMENTS[0];
}

export function createBuilderElement(type: BuilderElementType): BuilderElement {
  return { id: uid('e_'), type, data: getBuilderElementDef(type).defaults(), style: {} };
}

export function createColumn(elements: BuilderElement[] = []): BuilderColumn {
  return { id: uid('c_'), elements, style: {} };
}

export const COLUMN_LAYOUTS: { value: string; label: string }[] = [
  { value: '1', label: 'One column' },
  { value: '1-1', label: 'Two equal' },
  { value: '2-1', label: 'Wide + narrow' },
  { value: '1-2', label: 'Narrow + wide' },
  { value: '1-1-1', label: 'Three equal' },
  { value: '1-2-1', label: 'Wide centre' },
  { value: '1-1-1-1', label: 'Four equal' },
];

export function layoutFractions(layout: string): number[] {
  const parts = layout.split('-').map((n) => Number(n) || 1);
  return parts.length ? parts : [1];
}

/** Returns columns matching the layout, keeping content: extra columns' elements move into the last kept one. */
export function applyLayout(columns: BuilderColumn[], layout: string): BuilderColumn[] {
  const count = layoutFractions(layout).length;
  const next = columns.slice(0, count);
  while (next.length < count) next.push(createColumn());
  const overflow = columns.slice(count).flatMap((c) => c.elements);
  if (overflow.length) next[count - 1] = { ...next[count - 1], elements: [...next[count - 1].elements, ...overflow] };
  return next;
}

/** Finds an element anywhere in a custom section. */
export function findBuilderElement(data: CustomSectionData, id: string): { column: BuilderColumn; element: BuilderElement; index: number } | null {
  for (const column of data.columns ?? []) {
    const index = column.elements.findIndex((e) => e.id === id);
    if (index >= 0) return { column, element: column.elements[index], index };
  }
  return null;
}

/** Converts a YouTube or Vimeo page URL to its embeddable player URL, or null if unsupported. */
export function videoEmbedUrl(url: string): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}
