import fetch from 'node-fetch'
import { CodeValidator } from './codeValidator'
import { fixCommonIssues } from './codeAutoFixer'
import { ProjectAnalyzer } from './projectAnalyzer'
import { ChangeValidator } from './changeValidator'
const JSON5 = require('json5')
const balancedMatch: any = require('balanced-match')

export type Change = { path: string; content: string }

async function callOpenAI(prompt: string) {
  const key = process.env.OPENAI_API_KEY || process.env.VERCEL_AI_KEY
  if (!key) return null

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs a JSON array of file changes.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1500
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`OpenAI error: ${res.status} ${txt}`)
  }

  const json: any = await res.json()
  const text = json.choices?.[0]?.message?.content || json.choices?.[0]?.text || ''
  return { text, raw: json }
}

async function callAnthropic(prompt: string) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null

  // Default to the most capable Claude 3 model; allow override via ANTHROPIC_MODEL
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229' // Most capable model as of 2025

  const body: any = {
    model,
    prompt,
    max_tokens_to_sample: 1500
  }

  const res = await fetch('https://api.anthropic.com/v1/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Anthropic error: ${res.status} ${txt}`)
  }

  const json: any = await res.json()
  // Anthropic returns `completion` (text) in many API versions
  const text = json.completion || json.output || ''
  return { text, raw: json }
}

function extractJSON(output: string) {
  // Try direct JSON
  try {
    const parsed = JSON.parse(output)
    return { parsed, raw: output }
  } catch (e) {}

  // Try JSON5
  try {
    const parsed = JSON5.parse(output)
    return { parsed, raw: output }
  } catch (e) {}

  // Try to extract the first bracketed JSON object/array
  try {
    const m = balancedMatch('[', ']', output)
    if (m && m.body) {
      const candidate = `[${m.body}]`
      try {
        const parsed = JSON.parse(candidate)
        return { parsed, raw: candidate }
      } catch (e) {
        try {
          const parsed = JSON5.parse(candidate)
          return { parsed, raw: candidate }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return null
}

// Project-wide patterns and requirements
const PROJECT_PATTERNS = {
  architecture: [
    'Clean Architecture principles',
    'Service/Repository pattern',
    'Dependency injection',
    'Clear separation of concerns'
  ],
  codeStyle: [
    'Consistent error handling with typed errors',
    'Comprehensive TypeScript types',
    'Async/await for promises',
    'Functional programming patterns where appropriate'
  ],
  testing: [
    'Unit tests for business logic',
    'Integration tests for APIs',
    'Mocking external dependencies',
    'Test coverage for critical paths'
  ],
  security: [
    'Input validation',
    'Type-safe operations',
    'Proper error handling',
    'Secure default configurations'
  ]
}

const STYLE_GUIDE = {
  indentation: '2 spaces',
  quotes: 'single',
  semicolons: true,
  maxLineLength: 100,
  imports: 'sorted and grouped',
  naming: {
    interfaces: 'PascalCase with I prefix',
    types: 'PascalCase',
    functions: 'camelCase',
    constants: 'UPPER_CASE'
  }
}

const CODE_REQUIREMENTS = {
  typeChecking: true,
  errorHandling: true,
  documentation: true,
  testing: true,
  security: true
}

import { ContextAnalyzer } from './contextAnalyzer'
import { RepoFile } from './repoFetcher'

export async function generateChanges(prompt: string, repoPreview?: string, files?: RepoFile[]): Promise<{ changes: Change[]; aiRaw?: any }> {
  let projectContext = null
  let contextAnalysis = null
  
  if (files && files.length > 0) {
    // Analyze project structure and dependencies
    const projectAnalyzer = new ProjectAnalyzer(files)
    projectContext = projectAnalyzer.analyze()

    // Analyze code context
    const analyzer = new ContextAnalyzer(files)
    const fileMatch = prompt.match(/(?:modify|update|change|fix|in|create|the file)\s+['"](.*?)['"]/i)
    const targetFile = fileMatch ? fileMatch[1] : files[0].path
    contextAnalysis = analyzer.analyzeContext(targetFile, prompt)

    // Find related files for the target
    const relatedFiles = projectAnalyzer.findRelatedFiles(targetFile)
    if (relatedFiles.length > 0) {
      contextAnalysis.relevantFiles.push(...relatedFiles)
    }
  }
  // Build enhanced prompt with project context
  const fullPrompt = `You are an expert TypeScript developer working in this repository. Your task is to make INCREMENTAL improvements while maintaining existing functionality. Follow these strict guidelines:

CRITICAL REQUIREMENTS:
1. PRESERVE EXISTING FUNCTIONALITY - Do not remove or break working code
2. USE ONLY AVAILABLE DEPENDENCIES - Do not assume availability of packages
3. MAINTAIN EXISTING PATTERNS - Follow the patterns shown in related files
4. INCREMENTAL CHANGES - Make small, safe improvements rather than complete rewrites

PROJECT DEPENDENCIES:
${projectContext ? `
Available packages:
${projectContext.dependencies.production.map(d => `- ${d}`).join('\n')}

Development tools:
${projectContext.dependencies.development.map(d => `- ${d}`).join('\n')}

Frameworks in use:
${projectContext.frameworks.map(f => `- ${f}`).join('\n')}
` : '(No dependency information available)'}

DETECTED PATTERNS:
${projectContext ? 
  projectContext.patterns
    .map(p => `${p.type}:\n${p.examples.map(e => `- Found in: ${e}`).join('\n')}`)
    .join('\n\n')
  : ''}

STYLE GUIDE:
${Object.entries(STYLE_GUIDE)
  .map(([rule, value]) => typeof value === 'object' 
    ? `${rule}:\n${Object.entries(value).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : `- ${rule}: ${value}`)
  .join('\n')}

CODE REQUIREMENTS:
${Object.entries(CODE_REQUIREMENTS)
  .map(([req, enabled]) => `- ${req}: ${enabled ? 'required' : 'optional'}`)
  .join('\n')}

REPOSITORY CONTEXT:
${contextAnalysis ? `
Relevant Files:
${contextAnalysis.relevantFiles.map(f => `- ${f}`).join('\n')}

Related Types:
${contextAnalysis.typeDefinitions.map(t => `- ${t}`).join('\n')}

Applicable Patterns:
${contextAnalysis.relatedPatterns.map(p => `- ${p}`).join('\n')}
` : repoPreview || ''}

Based on these patterns and the repository context, implement these changes:
${prompt}

Respond ONLY with a JSON array of file changes. Each object must have:
{
  "path": "relative/path.ext",
  "content": "complete file contents including ALL necessary imports, types, and documentation"
}`

  // Prefer Anthropic (Claude) if API key present; fall back to OpenAI
  try {
    const anthropic = await callAnthropic(fullPrompt)
    if (anthropic && anthropic.text) {
      const extracted = extractJSON(anthropic.text)
      if (extracted && Array.isArray(extracted.parsed)) {
        const proposedChanges = (extracted.parsed as any[]).map((c: any) => ({ 
          path: String(c.path), 
          content: String(c.content) 
        }))

        // Validate each change
        const validator = new ChangeValidator(files || [])
        const validatedChanges: Change[] = []

        for (const change of proposedChanges) {
          const originalFile = files?.find(f => f.path === change.path)
          const validation = validator.validateChange(
            originalFile?.content || '',
            change.content,
            change.path
          )

          if (validation.warnings.length > 0) {
            console.warn(`Warnings for ${change.path}:`, validation.warnings)
          }

          if (validation.valid) {
            validatedChanges.push(change)
          } else {
            console.error(`Invalid change for ${change.path}:`, validation.errors)
            // Add warning comment to the code
            change.content = `// WARNING: The following changes need review:\n` +
              validation.errors.map(e => `// - ${e}`).join('\n') +
              '\n\n' + change.content
            validatedChanges.push(change)
          }
        }

        return { changes: validatedChanges, aiRaw: anthropic.raw || anthropic.text }
      }
    }
  } catch (aErr: any) {
    // swallow and try OpenAI as fallback
  }

  // Try OpenAI as a fallback
  try {
    const ai = await callOpenAI(fullPrompt)
    if (ai && ai.text) {
      // Extract JSON
      const extracted = extractJSON(ai.text)
      if (extracted && Array.isArray(extracted.parsed)) {
        // Normalize to Change[]
        const changes = (extracted.parsed as any[]).map((c: any) => ({ path: String(c.path), content: String(c.content) }))
        return { changes, aiRaw: ai.raw || ai.text }
      }
      // If parsing failed, fall through to simulated fallback
    }
  } catch (err: any) {
    // swallow and fallback to simulated change
  }

  // Fallback simulated change
  const simulated: Change = { path: 'SIMULATED_BY_AI.md', content: `Simulated changes for prompt:\n${prompt}` }
  return { changes: [simulated], aiRaw: { simulated: true } }
}

export default { generateChanges }
