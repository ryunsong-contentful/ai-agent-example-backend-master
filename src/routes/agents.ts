/**
 * GitHub agent endpoint examples
 *
 * Endpoint: POST /api/agents/github
 *
 * Body (JSON):
 * {
 *   "repoFullName": "owner/repo",         // required, e.g. cantstoptheunk/ai-agent-example
 *   "baseBranch": "main",                // required
 *   "prompt": "Please add a badge to README.md", // optional - if provided, AI will generate changes and they will be applied immediately
 *   "prTitle": "Optional PR title",
 *   "prBody": "Optional PR body",
 *   "changes": [{ "path": "README.md", "content": "Updated by AI agent" }],
 *   "openPr": false                         // optional, default false
 * }
 *
 * curl example:
 * curl -v -H "Content-Type: application/json" -X POST http://localhost:3000/api/agents/github \
 *   -d '{"repoFullName":"cantstoptheunk/ai-agent-example","baseBranch":"main","changes":[{"path":"README.md","content":"Updated by AI agent"}],"openPr":false}'
 *
 * Simulated response (when GITHUB_TOKEN is not set):
 * {
 *   "simulated": true,
 *   "branchName": "ai-agent/sim-163234234234",
 *   "diff": "--- a/README.md\n+++ b/README.md\n@@\n+Updated by AI agent\n",
 *   "aiSummary": "Simulated: missing GITHUB_TOKEN"
 * }
 *
 * Validation error example (missing required fields):
 * {
 *   "success": false,
 *   "error": {
 *     "_errors": [],
 *     "repoFullName": { "_errors": ["Invalid input: expected string, received undefined"] },
 *     "baseBranch": { "_errors": ["Invalid input: expected string, received undefined"] }
 *   }
 * }
 *
 * Note: the router is mounted at /api/agents in `src/server.ts`. POSTing to /github will return a 404.
 */
import { Router } from 'express'
import { z } from 'zod'
import githubAgent from '../agents/githubAgent'
import fetch from 'node-fetch'

const router = Router()

// GitHub agent endpoint - vertical slice
import AI from '../lib/ai'
import fetchFilesForPrompt from '../lib/repoFetcher'
import { Octokit } from '@octokit/rest'

const githubSchema = z.object({
    repoFullName: z.string().min(3),
    baseBranch: z.string().min(1),
    prompt: z.string().min(3).optional(),
    jiraIssueKey: z.string().optional(),
    jiraIssue: z.object({ title: z.string(), description: z.string().optional() }).optional(),
    prTitle: z.string().min(3).optional(),
    prBody: z.string().optional(),
    changes: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    openPr: z.boolean().optional().default(false)
})

router.post('/github', async (req, res) => {
    const parse = githubSchema.safeParse(req.body)
    if (!parse.success) return res.status(400).json({ success: false, error: parse.error.format() })

    console.log('[GITHUB] incoming body:', JSON.stringify(req.body))

    try {
        const data = { ...parse.data }

        // If prompt provided, generate changes with AI and use those (single-step flow).
        // This replaces any explicit `changes` in the request when `prompt` is present.
        if (data.prompt) {
            // Fetch a repo snapshot to send to the AI so it can make informed changes
            const snapshot = await fetchFilesForPrompt(data.repoFullName, data.baseBranch, { maxFiles: 40, perFileLimit: 16 * 1024, globalLimit: 150 * 1024 })
            // Build a compact preview: manifest + first few files (path + truncated content)
            const previewParts: string[] = []
            // If a Jira issue key or object was provided, fetch/append its title+description so AI has context
            let jiraContext = ''
            if (data.jiraIssue) {
                jiraContext = `JIRA ISSUE: ${data.jiraIssue.title}\n${data.jiraIssue.description || ''}`
            } else if (data.jiraIssueKey) {
                // attempt to fetch from Jira
                try {
                    const host = process.env.JIRA_HOST
                    const email = process.env.JIRA_EMAIL
                    const apiToken = process.env.JIRA_API_TOKEN
                    if (host && email && apiToken) {
                        const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
                        const issueUrl = `https://${host}/rest/api/3/issue/${encodeURIComponent(data.jiraIssueKey)}`
                        const r = await fetch(issueUrl, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
                        if (r.ok) {
                            const issueJson: any = await r.json()
                            const title = issueJson.fields?.summary
                            const desc = issueJson.fields?.description || issueJson.fields?.customfield_10002 || ''
                            jiraContext = `JIRA ISSUE: ${title}\n${typeof desc === 'string' ? desc : JSON.stringify(desc)}`
                        }
                    }
                } catch (e) {
                    // ignore
                }
            }
            previewParts.push(snapshot.manifest)
            if (jiraContext) previewParts.push(`----- JIRA CONTEXT -----\n${jiraContext}`)
            for (const f of snapshot.files.slice(0, 10)) {
                previewParts.push(`----- FILE: ${f.path} -----\n${f.content.slice(0, 1024)}\n`)
            }
            const repoPreview = previewParts.join('\n')

            // If a Jira issue was provided, prepend its title/description to the prompt so the AI knows the intent
            const augmentedPrompt = data.jiraIssue || data.jiraIssueKey ? `${data.jiraIssue ? data.jiraIssue.title + '\n' + (data.jiraIssue.description || '') : ''}\n${data.prompt || ''}` : data.prompt || ''

            const gen = await AI.generateChanges(augmentedPrompt, repoPreview)
            data.changes = gen.changes
            // If user didn't explicitly set openPr, default to opening a PR for prompt-driven requests
            if (typeof data.openPr === 'undefined') data.openPr = true
            // Attach aiRaw for debugging when requested via env flag
            if (process.env.DEV_SHOW_TOKENS) (data as any)._aiRaw = gen.aiRaw
        }

        try {
            const result = await githubAgent(data)
            return res.json({ success: true, ...result })
        } catch (agentErr: any) {
            console.error('[ROUTE] githubAgent threw', { message: agentErr?.message || String(agentErr) })
            const slackDebug = agentErr?.slackResponse || undefined
            const errorResponse = agentErr?.response || undefined
            const branches = agentErr?.branches || undefined
            return res.status(500).json({ success: false, error: agentErr?.message || String(agentErr), slackDebug, errorResponse, branches })
        }
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message || String(err) })
    }
})

// Jira: fetch issues for a board
const jiraSchema = z.object({
    boardId: z.string().min(1),
    maxResults: z.number().int().positive().optional().default(50)
})

router.get('/jira/issues', async (req, res) => {
    // Read params from query string
    const raw = { boardId: req.query.boardId, maxResults: req.query.maxResults ? Number(req.query.maxResults) : undefined }
    const parse = jiraSchema.safeParse(raw)
    if (!parse.success) return res.status(400).json({ success: false, error: parse.error.format() })

    const { boardId, maxResults } = parse.data
    console.log(`[JIRA] /jira/issues called - boardId=${boardId} maxResults=${maxResults} time=${new Date().toISOString()}`)
    const host = process.env.JIRA_HOST
    const email = process.env.JIRA_EMAIL
    const apiToken = process.env.JIRA_API_TOKEN

    if (!host || !email || !apiToken) {
        return res.status(500).json({ success: false, error: 'Missing JIRA_HOST, JIRA_EMAIL, or JIRA_API_TOKEN in environment' })
    }

    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
    const url = `https://${host}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/issue?maxResults=${maxResults}`

    try {
        const r = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
        if (!r.ok) {
            const txt = await r.text()
            return res.status(500).json({ success: false, error: `Jira API error: ${r.status} ${txt}` })
        }
        const j: any = await r.json()
        const issues = (j.issues || []).map((it: any) => ({
            id: it.id,
            key: it.key,
            summary: it.fields?.summary,
            status: it.fields?.status?.name,
            assignee: it.fields?.assignee ? { displayName: it.fields.assignee.displayName, accountId: it.fields.assignee.accountId } : null,
            labels: it.fields?.labels || [],
            priority: it.fields?.priority?.name || null,
            issueType: it.fields?.issuetype?.name || null,
            components: it.fields?.components?.map((c: any) => c.name) || [],
            created: it.fields?.created,
            updated: it.fields?.updated,
            description: it.fields?.description || null
        }))

        // Console a concise response summary for quick visibility
        try {
            const keys = issues.map((x: any) => x.key).slice(0, 50).join(',')
            console.log(`[JIRA] response summary - total=${j.total} returned=${issues.length} keys=${keys}`)
            if (process.env.DEV_SHOW_TOKENS) console.log('[JIRA] full response:', JSON.stringify(j))
        } catch (e) {
            // ignore logging errors
        }

        return res.json({ success: true, total: j.total, maxResults: j.maxResults, issues })
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message || String(err) })
    }
})

// List GitHub repositories (for dropdowns) - optional `owner` query param
router.get('/github/repos', async (req, res) => {
    const token = process.env.GITHUB_TOKEN
    if (!token) return res.status(500).json({ success: false, error: 'Missing GITHUB_TOKEN in environment' })

    const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined
    const octokit = new Octokit({ auth: token })
    const perPage = 100
    let page = 1
    const repos: Array<any> = []

    try {
        if (owner) {
            // Try org repos first
            try {
                while (true) {
                    const resp = await octokit.rest.repos.listForOrg({ org: owner, per_page: perPage, page })
                    if ((resp.data || []).length === 0) break
                    repos.push(...resp.data)
                    if ((resp.data || []).length < perPage) break
                    page++
                }
            } catch (orgErr: any) {
                // Fallback to user repos
                page = 1
                while (true) {
                    const resp = await octokit.rest.repos.listForUser({ username: owner, per_page: perPage, page })
                    if ((resp.data || []).length === 0) break
                    repos.push(...resp.data)
                    if ((resp.data || []).length < perPage) break
                    page++
                }
            }
        } else {
            // List authenticated user's repos
            while (true) {
                const resp = await octokit.rest.repos.listForAuthenticatedUser({ per_page: perPage, page })
                if ((resp.data || []).length === 0) break
                repos.push(...resp.data)
                if ((resp.data || []).length < perPage) break
                page++
            }
        }

        const simplified = repos.map(r => ({ full_name: r.full_name, name: r.name, private: r.private, default_branch: r.default_branch }))
        return res.json({ success: true, repos: simplified })
    } catch (err: any) {
        console.error('[GITHUB] list repos failed', { message: err?.message || String(err) })
        return res.status(500).json({ success: false, error: err.message || String(err) })
    }
})

export default router

