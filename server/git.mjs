// Git operations for the project, scoped to the site folder. Uses the git CLI.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { ProjectError, toPosix } from './project.mjs';

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new ProjectError(400, (stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

export class Git {
  constructor(siteRoot) {
    this.siteRoot = siteRoot;
  }

  async repoRoot() {
    this._root ??= run(['rev-parse', '--show-toplevel'], this.siteRoot)
      .then((out) => path.resolve(out.trim()))
      .catch(() => null);
    return this._root;
  }

  /** Path of the site folder inside the repository ("site"). */
  async sitePathspec() {
    const root = await this.repoRoot();
    if (!root) throw new ProjectError(400, 'This project is not inside a Git repository. Run "git init" first.');
    return toPosix(path.relative(root, this.siteRoot)) || '.';
  }

  /** Converts a repo-relative path to a site-relative one. */
  async toSite(repoRel) {
    const spec = await this.sitePathspec();
    return spec === '.' ? repoRel : repoRel.startsWith(spec + '/') ? repoRel.slice(spec.length + 1) : repoRel;
  }

  async toRepo(siteRel) {
    const spec = await this.sitePathspec();
    return spec === '.' ? siteRel : `${spec}/${siteRel}`;
  }

  async status() {
    const root = await this.repoRoot();
    if (!root) return { repo: false, branch: null, files: [] };
    const spec = await this.sitePathspec();
    const out = await run(['status', '--porcelain=v1', '-b', '--untracked-files=all', '--', spec], root);
    const lines = out.split('\n').filter(Boolean);
    const branchLine = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : '';
    const branch = branchLine.split('...')[0].replace(/^No commits yet on /, '');
    const files = [];
    for (const line of lines) {
      const code = line.slice(0, 2);
      let file = line.slice(3);
      if (file.includes(' -> ')) file = file.split(' -> ')[1];
      file = file.replace(/^"|"$/g, '');
      const status = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code.includes('R') ? 'renamed' : 'modified';
      files.push({ path: await this.toSite(file), status, staged: code[0] !== ' ' && code[0] !== '?' });
    }
    return { repo: true, branch, files };
  }

  /** File content at a ref (default HEAD), or null if it didn't exist there. */
  async show(siteRel, ref = 'HEAD') {
    const root = await this.repoRoot();
    try {
      return await run(['show', `${ref}:${await this.toRepo(siteRel)}`], root);
    } catch {
      return null;
    }
  }

  async diff(siteRel) {
    const root = await this.repoRoot();
    const spec = siteRel ? await this.toRepo(siteRel) : await this.sitePathspec();
    return run(['diff', 'HEAD', '--', spec], root).catch(() => run(['diff', '--', spec], root));
  }

  async log(limit = 20) {
    const root = await this.repoRoot();
    if (!root) return [];
    const spec = await this.sitePathspec();
    const out = await run(['log', `-${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s', '--', spec], root).catch(() => '');
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, short, author, date, subject] = l.split('\x1f');
        return { hash, short, author, date, subject };
      });
  }

  async branches() {
    const root = await this.repoRoot();
    if (!root) return { current: null, all: [] };
    // for-each-ref formats use %09-style hex escapes (not %x09 like git log).
    const out = await run(['branch', '--format=%(refname:short)%09%(HEAD)'], root);
    const all = out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.trimEnd().split('\t'));
    return { current: all.find(([, head]) => head === '*')?.[0] ?? null, all: all.map(([name]) => name) };
  }

  /** Commits all changes inside the site folder (only those paths). */
  async commit(message) {
    if (!message?.trim()) throw new ProjectError(400, 'Enter a commit message');
    const root = await this.repoRoot();
    const spec = await this.sitePathspec();
    await run(['add', '-A', '--', spec], root);
    const out = await run(['commit', '-m', message.trim(), '--', spec], root);
    return out.trim().split('\n')[0];
  }

  async createBranch(name, checkout = true) {
    if (!/^[\w./-]+$/.test(name ?? '') || name.startsWith('-')) throw new ProjectError(400, 'Invalid branch name');
    const root = await this.repoRoot();
    await run(checkout ? ['switch', '-c', name] : ['branch', name], root);
  }

  async switchBranch(name) {
    if (!/^[\w./-]+$/.test(name ?? '') || name.startsWith('-')) throw new ProjectError(400, 'Invalid branch name');
    await run(['switch', name], await this.repoRoot());
  }

  /** Discards uncommitted changes to one file (restores it from HEAD, or deletes it if untracked). */
  async revert(siteRel) {
    const root = await this.repoRoot();
    const repoRel = await this.toRepo(siteRel);
    const tracked = await run(['ls-files', '--error-unmatch', '--', repoRel], root).then(
      () => true,
      () => false,
    );
    if (tracked) await run(['restore', '--staged', '--worktree', '--source=HEAD', '--', repoRel], root);
    else await run(['clean', '-f', '--', repoRel], root);
  }
}
