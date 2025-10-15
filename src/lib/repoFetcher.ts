import fs from 'fs'
import path from 'path'
import { Octokit } from '@octokit/rest'

export type RepoFile = { path: string; content: string; size: number }

export async function fetchFilesForPrompt(repoFullName: string, baseBranch: string, options?: {
  maxFiles?: number
  perFileLimit?: number
  globalLimit?: number
}) : Promise<{ files: RepoFile[], manifest: string }>{
  const maxFiles = options?.maxFiles ?? 50
  const perFileLimit = options?.perFileLimit ?? 32 * 1024 // 32kb
  const globalLimit = options?.globalLimit ?? 200 * 1024 // 200kb

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN
  const files: RepoFile[] = []
  let manifest = ''

  const addFile = (p: string, contentRaw: string) => {
    let content = String(contentRaw)
    let size = Buffer.byteLength(content)
    if (size > perFileLimit) {
      content = content.slice(0, perFileLimit) + '\n/* TRUNCATED */'
      size = Buffer.byteLength(content)
    }
    files.push({ path: p, content, size })
  }

  if (GITHUB_TOKEN) {
    const [owner, repo] = repoFullName.split('/')
    const octokit = new Octokit({ auth: GITHUB_TOKEN })
    // try to get recursive tree for branch
    try {
      const ref = await octokit.rest.repos.getBranch({ owner, repo, branch: baseBranch })
      const commitSha = ref.data.commit.sha
      const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: commitSha, recursive: '1' })
      const treeFiles = (tree.data.tree || []).filter((t: any) => t.type === 'blob')
      // simple whitelist and blacklist
      const whitelist = [/\.ts$/, /\.js$/, /\.json$/, /\.md$/, /\.yml$/, /\.yaml$/, /\.tsx$/, /\.jsx$/]
      const blacklist = [/^node_modules\//, /^\.git\//, /^dist\//, /\.env$/i]
      const candidates = treeFiles
        .map((t: any) => ({ path: t.path, size: t.size || 0 }))
        .filter((f: any) => whitelist.some(rx => rx.test(f.path)) && !blacklist.some(rx => rx.test(f.path)))
        .slice(0, maxFiles)

      manifest = `Included files: ${candidates.map((c: any) => c.path).join(', ')}`

      for (const c of candidates) {
        try {
          const node = tree.data.tree.find((x: any) => x.path === c.path)
          const sha = node?.sha
          if (!sha) continue
          const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: sha })
          const encoded = typeof blob.data.content === 'string' ? blob.data.content : ''
          const content = Buffer.from(encoded, 'base64').toString('utf8')
          addFile(c.path, content)
          const total = files.reduce((s, f) => s + f.size, 0)
          if (total >= globalLimit) break
        } catch (e) {
          // skip file on error
        }
      }
    } catch (e) {
      // fallback to contents API listing top-level
      try {
        const list = await octokit.rest.repos.getContent({ owner: repoFullName.split('/')[0], repo: repoFullName.split('/')[1], path: '' })
        const names = (list.data as any[]).slice(0, maxFiles).map(f => f.name)
        manifest = `Top-level files: ${names.join(', ')}`
      } catch (err) {
        manifest = 'Could not fetch repo contents'
      }
    }
  } else {
    // local filesystem fallback - read src/ and a few root files
    const root = path.resolve(process.cwd())
    const toTry = ['package.json','tsconfig.json','README.md']
    for (const t of toTry) {
      const p = path.join(root, t)
      if (fs.existsSync(p)) {
        try { addFile(t, fs.readFileSync(p, 'utf8')) } catch (e) {}
      }
    }
    // read source files under src
    const srcDir = path.join(root, 'src')
    if (fs.existsSync(srcDir)) {
      const walk = (dir: string) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name)
          const rel = path.relative(root, full)
          const stat = fs.statSync(full)
          if (stat.isDirectory()) {
            if (['node_modules','.git','dist'].includes(name)) continue
            walk(full)
          } else {
            if (/\.(ts|js|json|md|yml|yaml|tsx|jsx)$/.test(name)) {
              try { addFile(rel, fs.readFileSync(full, 'utf8')) } catch (e) {}
              if (files.length >= maxFiles) return
            }
          }
        }
      }
      walk(srcDir)
    }
    manifest = `Local files included: ${files.map(f=>f.path).slice(0,10).join(', ')}`
  }

  return { files, manifest }
}

export default fetchFilesForPrompt
