import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentDef } from './engine/render';
import { setSectionDefs } from './section-registry';

/** Loads the real components from site/components/ and registers them, like the app does at startup. */
export function loadSiteComponents(): ComponentDef[] {
  const root = join(process.cwd(), 'site', 'components');
  const components = readdirSync(root).map((folder: string) => {
    const dir = join(root, folder);
    const schema = JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8'));
    return { ...schema, folder, template: readFileSync(join(dir, 'component.html'), 'utf8'), css: readFileSync(join(dir, 'component.css'), 'utf8') };
  });
  setSectionDefs(components);
  return components;
}
