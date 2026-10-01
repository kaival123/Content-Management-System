# Landing pages — developer guide

This folder is the landing-page project. The visual editor (the CMS at `/admin`) and your code
editor work on **the same files**: whatever you change here shows up in the visual editor as soon
as you save, and every change made in the visual editor is written back here.

```
site/
├── websites/<site>/                one folder per website (single- or multi-page)
│   ├── website.json                name, status, homepage, page tree (order + nesting), theme
│   ├── website.css                 site-wide custom CSS (optional)
│   └── pages/<page>/               one folder per page (flat — nesting lives in website.json)
│       ├── page.json               title, SEO, section order
│       ├── page.css                page custom CSS (optional)
│       ├── page.js                 page JavaScript for the static build (optional)
│       └── sections/
│           ├── hero-s_xxx.json     one file per section: content, style, element styles
│           └── hero-s_xxx.css      that section's custom CSS (optional)
├── components/<Name>/     reusable section types
│   ├── component.html     template (syntax below)
│   ├── component.css      styles
│   └── schema.json        editable fields, clickable elements, defaults
├── styles/base.css        shared styles: typography, buttons, cards, grids, utilities
├── scripts/main.js        site-wide JavaScript for the static build
├── assets/                images (uploads land in assets/images/), fonts, icons
├── templates/*.json       single-page, multi-page and blank website templates
├── library/<category>/    section presets for the editor's "Add section" library
│   └── saved/             sections saved from the editor as reusable
├── config/site.json       project settings, default theme, component and library order
└── dist/                  static build output — generated, not committed
```

## Workflow

```bash
npm start          # project server + CMS on http://localhost:4200/admin
```

- **Visual → code:** edit in the CMS; files update within a second (and `dist/` is rebuilt).
- **Code → visual:** save a file in VS Code; the editor preview updates immediately.
- **Both at once:** if the visual editor has unsaved edits when a file changes on disk, it
  stops saving and asks you to keep your version, keep the code version, or review a diff.
  It never overwrites files silently. Developer Mode does the same for files you have open.
- **Git:** commit, branch and review diffs from Developer Mode or your usual Git tools.

## Websites

`website.json` holds everything shared by a website's pages:

```json
{
  "name": "Northwind Partners",
  "status": "published",
  "homepage": "home",
  "pages": [
    { "slug": "home" },
    { "slug": "services", "children": [{ "slug": "consulting" }, { "slug": "strategy" }] },
    { "slug": "login", "hideInMenu": true },
    { "slug": "contact", "menuLabel": "Get in touch" }
  ],
  "theme": { "primaryColor": "#2563eb", "headingFont": "Poppins" }
}
```

- **`pages`** sets the order and nesting of pages. Nesting drives URLs (`/services/consulting`) and menu dropdowns.
  - Reordering or nesting a page edits this file only; page folders never move.
  - A page folder that isn't listed here is added at the end.
- **`homepage`** is served at the website's root.
- **`theme`** applies to every page.
- **Links between pages** are written `"page:<slug>"` (optionally `"page:pricing#faq"`) in any link field. They resolve to the right URL in the editor, preview and static build. Renaming a page's URL in the CMS updates these links automatically.
- **Menus:** navbars and footers with `"useSiteMenu": true` render the page tree as a menu. In templates, the menu is available as `@menu`: a list of `{ label, href, active, children }`.

## Pages

`page.json` lists sections in order by file name (without `.json`). Section files that exist
but aren't listed are appended, so you can add a section by creating a file. A section file:

```json
{
  "id": "s_abc123",
  "type": "hero",
  "visible": true,
  "data": { "heading": "Build something people love" },
  "style": { "background": "__surface__", "paddingY": 96, "align": "center" },
  "elements": { "heading": { "fontSize": 72, "color": "__primary__" } }
}
```

- `type` is a component's `schema.json` type.
- `data` holds the fields declared in that schema.
- Colours can be CSS colours or theme tokens: `__primary__`, `__accent__`, `__text__`, `__bg__`, `__surface__`.
- Width and height (Style → Layout):
  - Width: `width` (`boxed` / `narrow` / `full` / `custom` with `contentWidth`) and `paddingSide` (left/right space; 0 = edge to edge).
  - Height: `heightMode` (`auto` / `min` / `fixed`), `heightUnit` (`px` or `vh`), and `heightDesktop` / `heightTablet` / `heightMobile`. A missing tablet or mobile value uses the next larger device's value.

## Components

Create `components/MySection/` with the three files (Developer Mode → *New component* does it
for you). It appears in the visual editor's **Add section** menu immediately.

### schema.json

```json
{
  "type": "my-section",
  "label": "My section",
  "description": "Shown in the Add section menu",
  "icon": "layout",
  "fields": [
    { "key": "heading", "label": "Heading", "type": "text" },
    { "key": "items", "label": "Items", "type": "list", "itemLabel": "Item",
      "itemFields": [{ "key": "title", "label": "Title", "type": "text" }] }
  ],
  "elements": [
    { "key": "heading", "label": "Heading", "kind": "text", "fields": ["heading"] },
    { "key": "item", "label": "Items", "kind": "box", "list": "items", "fields": ["title"] }
  ],
  "defaults": { "heading": "Hello", "items": [{ "title": "One" }] },
  "grid": { "desktop": 3, "tablet": 2, "mobile": 1 }
}
```

- **Field types:** `text`, `textarea`, `url`, `image`, `color`, `number`, `select` (with `options`), `toggle`, `lines`, `list`.
- **`elements`:** these become clickable and styleable in the editor.
  - `kind` picks the style controls: `text`, `button`, `image` or `box`.
  - `list` marks an element that repeats once per item.
- **`grid`:** add this to give the section a Grid tab (columns per device, gap, card style).

### component.html

A small Handlebars-style language. Output is HTML-escaped. `javascript:` URLs are removed.

| Syntax | Meaning |
| --- | --- |
| `{{ heading }}` | value (escaped) |
| `{{{ html }}}` | raw HTML (sanitised) |
| `{{#if x}}…{{else}}…{{/if}}` / `{{#unless x}}` | conditionals |
| `{{#each items}}…{{/each}}` | loop — `this`, `@index`, `@first`, `@last`, `../parentField` |
| `{{#is level "h1"}}…{{/is}}` | equality |
| `{{ color background }}` | helper call (see below) |
| `{{#if @editor}}` | true only inside the visual editor |
| `{{!-- comment --}}` | comment |

**Helpers:**

| Helper | What it does |
| --- | --- |
| `color` | theme token → CSS |
| `default value fallback` | uses the fallback when the value is empty |
| `initials` | "Ada Lovelace" → "AL" |
| `json` | the value as JSON |
| `marker` | CSS string for a list bullet symbol |
| `video` | YouTube/Vimeo link → embed URL |
| `columns` | column layout ("2-1") → `grid-template-columns` |
| `tag` | safe heading tag name |
| `eq` | equality test |
| `join` | joins a list |

**Editor hooks (plain attributes):**

| Attribute | Effect |
| --- | --- |
| `data-el="key"` | the element can be selected and styled (matches `elements[].key`) |
| `data-edit="field"` | its text can be edited directly on the canvas |
| `data-grid` | a container that receives the section's grid settings |

```html
<h2 class="lp-h2" data-el="heading" data-edit="heading">{{heading}}</h2>
<div class="lp-grid" data-grid>
  {{#each items}}<div class="lp-card" data-el="item" data-edit="title">{{title}}</div>{{/each}}
</div>
```

### component.css

Plain CSS, loaded on every page. Scope rules with the section class `.lp-sec-<type>`, or with
class names unique to your component. Theme values are available as CSS variables:

- **Colours:** `--lp-primary`, `--lp-accent`, `--lp-text`, `--lp-bg`, `--lp-surface`
- **Fonts:** `--lp-font`, `--lp-heading-font`
- **Shape and width:** `--lp-radius`, `--lp-max`

Use container queries (`@container (max-width: 600px)`), not media queries. The editor
previews devices by resizing the page container, so media queries won't respond there.

## Templates and the section library

- **`templates/<id>.json`** is a starting point for a new website. It has:
  - `kind`: `"single"` or `"multi"`
  - `category` and `theme`
  - `pages`: `{ slug, title, sections, children? }`, where the first page is the homepage

  Each section lists only what differs from its component's defaults: `{ "type": "hero", "data": { … }, "style": { … } }`. Add a file and it appears in *Create new website*.
- **`library/<category>/<name>.json`** is a preset in the *Add section* library:

  ```json
  { "name": "Split hero", "description": "…", "section": { "type": "hero", "data": { "layout": "split" } } }
  ```

  A new category folder shows up automatically. Set its label and position in `config/site.json` → `libraryCategories`.
- **Saved sections** land in `library/saved/` as the same format. They're copies: inserting one doesn't link it to the original.

## Carousels

The `Carousel` component has slide layouts (`variant`): hero, image, card, content, testimonial, logo, product, team and portfolio. The slider types in the library are presets of it. The section's `carousel` settings control its behaviour:

```json
"carousel": {
  "perViewDesktop": 4, "perViewTablet": 2, "perViewMobile": 1, "gap": 24,
  "autoplay": true, "autoplaySpeed": 4000, "speed": 500, "loop": true, "center": false,
  "arrows": true, "dots": true, "drag": true, "touch": true, "keyboard": true,
  "transition": "slide", "pauseOnHover": true,
  "arrowPosition": "sides", "arrowStyle": "circle", "arrowSize": 44,
  "dotsPosition": "below", "dotsStyle": "pills", "controlColor": ""
}
```

Controls:

| Setting | Values |
| --- | --- |
| `arrowPosition` | Top: `top-left`, `top-center`, `top-right`. Bottom: `bottom-left`, `bottom-center` (either side of the pagination, classic Owl), `bottom-right`. Stacked beside the slides: `left`, `right`. One on each side: `sides` (on the slides), `outside` (beside them). Beside-the-slides positions narrow the slides to make room. |
| `arrowStyle` | `circle`, `square`, `outline`, `solid`, `minimal` |
| `dotsPosition` | `below`, `below-left`, `below-right`, `overlay` (over the slides) |
| `dotsStyle` | `pills`, `dots`, `lines`, `numbers` (01 02 03), `fraction` (2 / 6), `progress` (a bar), `thumbs` (each slide's image) |
| `prevX`, `prevY`, `nextX`, `nextY` | move the left / right arrow from its position, in px (+x right, +y down) |
| `heightMode` | `auto` (from the content), `fixed` (`heightDesktop` / `heightTablet` / `heightMobile`, px) or `screen` (`screenDesktop` / `screenTablet` / `screenMobile`, % of the screen height) |
| `transition` | `slide`, `fade` or `flip` (3D); fade and flip show one slide at a time |
| `contentX`, `contentY` | where the text sits in each slide: `left` / `center` / `right` and `top` / `middle` / `bottom` (`""` = the layout's default) |
| `contentMoveX`, `contentMoveY`, `contentMovePhones` | shift the slide text from its position, px (+x right, +y down); phones keep it in place unless `contentMovePhones` is true |
| `flipLayout`, `mirrorImages` | swap the order inside slides (image below text, author above quote…); mirror images horizontally |
| `controlColor` | colour of the active dot, progress bar and solid arrows (theme token or CSS colour; empty = primary) |

The runtime wraps the viewport in `.lp-car-stage` and adds `.lp-car-bar-top` / `.lp-car-bar-bottom` for arrows and pagination that sit above or below the slides. Style them in `component.css`.

Any component can become a carousel. Add a `carousel` block to its schema.json (to get the Slider tab) and markup like this:

```html
<div class="lp-carousel" data-carousel>
  <div class="lp-car-viewport"><div class="lp-car-track">
    {{#each slides}}<div class="lp-car-slide" data-el="slide">…</div>{{/each}}
  </div></div>
</div>
```

`perViewDesktop`, `perViewTablet` and `perViewMobile` take 1–12 and are used as given: with fewer slides than that, the rest of the row stays empty.

The runtime (the same code in the editor, the preview and `dist/assets/runtime.js`) then adds the arrows, dots, looping, autoplay, drag, swipe and keyboard control. Without JavaScript, CSS alone shows the first slides.

## FAQ and accordions

`components/FAQ` powers both the FAQ and the Accordions presets in the library. On the site, answers open and close with a smooth height animation (the runtime's `initAccordions`, for any `<details data-accordion>`; `data-accordion="single"` closes the others in the same list, `data-speed` sets the duration in ms). In the editor all answers stay open so they can be edited.

Its fields:

| Field | Values |
| --- | --- |
| `layout` | `stacked`, `two-column` or `split` (heading, subheading and button on the left) |
| `style` | `boxed`, `divided`, `filled`, `cards`, `accent`, `minimal` |
| `icon`, `iconPosition` | `plus`, `chevron`, `circle`, `none`; `right` or `left` |
| other options | `numbered`, `singleOpen`, `openFirst`, `speed`, plus `eyebrow`, `subheading`, per-item `icon` (emoji) and an optional button (`ctaText`, `buttonLabel`, `buttonHref`) |

## Back to top button

`components/BackToTop` (Add section → Back to top) is a floating button: on the site it stays hidden until the visitor has scrolled `showAfter` px, then fades in and scrolls back to the top when clicked (smoothly unless `smooth` is off or the visitor prefers reduced motion). Its settings are ordinary fields: `shape` (circle, rounded, square, pill), `icon` (arrow, chevron, double, caret), `label`, `position` (right, left, center), `offsetX` / `offsetY`, `size`, `background`, `iconColor`, `progress` (a ring that fills as the page scrolls), `shadow`, `hideOnMobile`. Add it once per page; where it sits in the section list doesn't matter. In the editor it shows as a placeholder so it doesn't cover the canvas.

Any element with `data-back-to-top` (and optionally `data-show-after="400"`, `data-smooth="false"`) gets the same behaviour from the runtime.

## Static build

`dist/` contains plain HTML/CSS/JS for every page of every **published** website:

- `dist/<site>/index.html` is the homepage.
- `dist/<site>/<path>/index.html` holds the other pages.
- Links between pages are relative, so the build works from any folder or domain.

The build is rebuilt automatically after each save or with **Build site** in Developer Mode. Deploy it to
any static host (Netlify, Vercel, GitHub Pages, S3…).

To receive contact-form submissions on the live site, set `export.formEndpoint` in
`config/site.json` (e.g. a Formspree URL).
