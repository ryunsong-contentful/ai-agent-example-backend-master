import { Octokit } from '@octokit/rest'
import dotenv from 'dotenv'
import { WebClient } from '@slack/web-api'

dotenv.config()

type Change = { path: string; content: string }

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

async function githubAgent(opts: {
    repoFullName: string
    baseBranch: string
    prTitle?: string
    prBody?: string
    changes?: Change[]
    openPr?: boolean
    slackChannel?: string
}) {
    if (!GITHUB_TOKEN) {
        // Simulate response when token missing
        const branch = `ai-agent/sim-${Date.now()}`
        const diff = (opts.changes || []).map(c => `--- a/${c.path}\n+++ b/${c.path}\n@@\n+${c.content}\n`).join('\n')
        return { simulated: true, branchName: branch, diff, aiSummary: 'Simulated: missing GITHUB_TOKEN' }
    }

    const [owner, repo] = opts.repoFullName.split('/')
    if (!owner || !repo) throw new Error('repoFullName must be in owner/repo format')

    const octokit = new Octokit({ auth: GITHUB_TOKEN })

    // 1) get base branch commit SHA and tree SHA (with fallback to repository default branch)
    let baseCommitSha: string
    let baseTreeSha: string
    let usedBaseBranch = opts.baseBranch
    try {
        const { data: baseRef } = await octokit.rest.repos.getBranch({ owner, repo, branch: opts.baseBranch })
        baseCommitSha = baseRef.commit.sha
        // commit contains nested commit metadata with tree sha
        baseTreeSha = (baseRef.commit as any).commit?.tree?.sha || ''
    } catch (err: any) {
        // If branch not found, try repo default branch
        if (err && (err.status === 404 || /Branch not found/.test(String(err.message || '')))) {
            const repoInfo = await octokit.rest.repos.get({ owner, repo })
            const defaultBranch = repoInfo.data.default_branch
            if (!defaultBranch) {
                // As a last resort, list branches
                const branches = await octokit.rest.repos.listBranches({ owner, repo })
                const names = branches.data.map(b => b.name)
                throw new Error(`Branch '${opts.baseBranch}' not found. Available branches: ${names.join(', ')}`)
            }
            usedBaseBranch = defaultBranch
            const { data: baseRef } = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch })
            baseCommitSha = baseRef.commit.sha
            baseTreeSha = (baseRef.commit as any).commit?.tree?.sha || ''
        } else {
            throw err
        }
    }

    // If we couldn't find a tree SHA from the branch metadata, fetch the commit object to get the tree SHA
    if (!baseTreeSha) {
        try {
            const commitObj = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseCommitSha })
            baseTreeSha = commitObj.data.tree.sha
        } catch (treeErr: any) {
            // If still failing, surface a helpful error
            throw new Error(`Could not determine repository tree SHA for base branch '${usedBaseBranch}': ${treeErr?.message || String(treeErr)}`)
        }
    }

    // 2) create a new branch
    const branchName = `ai-agent/${Date.now()}`
    try {
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: baseCommitSha })
    } catch (createRefErr: any) {
        console.error('[GITHUB] createRef failed', { owner, repo, branchName, message: createRefErr?.message || String(createRefErr) })
        throw createRefErr
    }

    // 3) create blobs and tree
    const blobs = [] as { path: string; sha: string }[]
    for (const change of opts.changes || []) {
            try {
                const blob = await octokit.rest.git.createBlob({ owner, repo, content: Buffer.from(change.content).toString('base64'), encoding: 'base64' })
                blobs.push({ path: change.path, sha: blob.data.sha })
            } catch (blobErr: any) {
                console.error('[GITHUB] createBlob failed', { path: change.path, message: blobErr?.message || String(blobErr) })
                throw blobErr
            }
    }

    // 4) create tree
    // use the repository tree SHA as the base_tree (GitHub API expects a tree SHA)
    let tree: any
    try {
    tree = await octokit.rest.git.createTree({ owner, repo, base_tree: baseTreeSha, tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })) })
    } catch (treeErr: any) {
        console.error('[GITHUB] createTree failed', { message: treeErr?.message || String(treeErr) })
        throw treeErr
    }

    // 5) create commit
    let commit: any
    try {
    commit = await octokit.rest.git.createCommit({ owner, repo, message: opts.prTitle || 'AI-generated changes', tree: tree.data.sha, parents: [baseCommitSha] })
    } catch (commitErr: any) {
        console.error('[GITHUB] createCommit failed', { message: commitErr?.message || String(commitErr) })
        throw commitErr
    }

    // 6) update ref
    try {
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branchName}`, sha: commit.data.sha })
    } catch (updateRefErr: any) {
        console.error('[GITHUB] updateRef failed', { owner, repo, branchName, message: updateRefErr?.message || String(updateRefErr) })
        throw updateRefErr
    }

    // 7) open PR if requested
    let prUrl: string | undefined
    let slackMessageSent = false
    let slackResponse: any = undefined
    if (opts.openPr) {
        try {
            // Ensure the requested base branch exists before creating the PR. If it doesn't, fall back to repo default branch.
            try {
                await octokit.rest.repos.getBranch({ owner, repo, branch: usedBaseBranch })
            } catch (baseCheckErr: any) {
                console.warn('[GITHUB] requested base branch not found, attempting to use repository default branch', { requestedBase: usedBaseBranch, message: baseCheckErr?.message || String(baseCheckErr) })
                try {
                    const repoInfo = await octokit.rest.repos.get({ owner, repo })
                    const defaultBranch = repoInfo.data?.default_branch
                    if (defaultBranch && defaultBranch !== usedBaseBranch) {
                        console.debug('[GITHUB] switching base branch to repository default', { from: usedBaseBranch, to: defaultBranch })
                        usedBaseBranch = defaultBranch
                    }
                } catch (repoInfoErr: any) {
                    console.debug('[GITHUB] could not determine repository default branch', { message: repoInfoErr?.message || String(repoInfoErr) })
                }
            }

            const pr = await octokit.rest.pulls.create({ owner, repo, head: branchName, base: usedBaseBranch, title: opts.prTitle || 'AI: Proposed changes', body: opts.prBody || '' })
            prUrl = pr.data.html_url
            // After PR is created, send a Slack message if possible
            try {
                const slackToken = process.env.SLACK_BOT_TOKEN
                const channel = opts.slackChannel || process.env.SLACK_CHANNEL
                if (slackToken && channel && prUrl) {
                    const slack = new WebClient(slackToken)
                    const text = `New PR created: <${prUrl}|${opts.prTitle || 'AI: Proposed changes'}>\nRepository: ${opts.repoFullName}\nBranch: ${branchName}`
                    const slackRes = await slack.chat.postMessage({ channel, text })
                    slackResponse = slackRes
                    slackMessageSent = true
                } else {
                    console.warn('[SLACK] skipping postMessage - missing token or channel')
                }
            } catch (slackErr: any) {
                // include Slack errors in response and log details for debugging
                console.error('[SLACK] postMessage failed', { message: slackErr?.message || String(slackErr) })
                slackResponse = { error: String(slackErr), details: slackErr?.response || undefined }
            }
        } catch (prErr: any) {
            // surface a clearer error and log helpful octokit response details
            console.error('[GITHUB] createPR failed', { message: prErr?.message || String(prErr) })

            // Attempt to fetch branch names for additional context (useful for debugging invalid base errors)
            let branchNames: string[] = []
            try {
                const branchesResp = await octokit.rest.repos.listBranches({ owner, repo })
                branchNames = (branchesResp.data || []).map((b: any) => b.name)
            } catch (branchErr: any) {
                console.debug('[GITHUB] could not list branches for debugging', { message: branchErr?.message || String(branchErr) })
            }

            const msg = prErr?.message || String(prErr)
            const newErr: any = new Error(`Failed to create PR: ${msg}`)
            // Attach structured debug info so callers (routes) can surface it
            newErr.status = prErr?.status || prErr?.statusCode || undefined
            newErr.response = prErr?.response?.data || prErr?.response || undefined
            newErr.branches = branchNames
            throw newErr
        }
    }
    return { simulated: false, branchName, prUrl, aiSummary: `Created branch from ${usedBaseBranch} and optional PR`, slackMessageSent, slackResponse }
}

export default githubAgent
