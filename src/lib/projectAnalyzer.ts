import * as fs from 'fs'
import * as path from 'path'
import { RepoFile } from './repoFetcher'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface ProjectContext {
  dependencies: {
    production: string[]
    development: string[]
    peer: string[]
  }
  frameworks: string[]
  patterns: {
    type: string
    examples: string[]
  }[]
  fileTypes: {
    extension: string
    count: number
  }[]
}

/**
 * Analyzes repository contents to understand project structure and dependencies
 */
export class ProjectAnalyzer {
  private packageJson: PackageJson = {}
  private frameworks: Set<string> = new Set()
  private patterns: Map<string, Set<string>> = new Map()
  private fileTypes: Map<string, number> = new Map()

  constructor(private files: RepoFile[]) {
    this.initialize()
  }

  private initialize() {
    // Parse package.json if it exists
    const packageJsonFile = this.files.find(f => f.path.endsWith('package.json'))
    if (packageJsonFile) {
      try {
        this.packageJson = JSON.parse(packageJsonFile.content)
      } catch (e) {
        console.warn('Failed to parse package.json:', e)
      }
    }

    // Analyze file types
    for (const file of this.files) {
      const ext = path.extname(file.path)
      if (ext) {
        this.fileTypes.set(ext, (this.fileTypes.get(ext) || 0) + 1)
      }
    }

    // Detect frameworks and patterns
    this.detectFrameworks()
    this.detectPatterns()
  }

  private detectFrameworks() {
    const deps = {
      ...this.packageJson.dependencies,
      ...this.packageJson.devDependencies
    }

    // React detection
    if (deps?.['react']) {
      this.frameworks.add('react')
      if (deps['@types/react']) this.frameworks.add('typescript')
      if (deps['react-router-dom']) this.frameworks.add('react-router')
      if (deps['@emotion/react'] || deps['styled-components']) this.frameworks.add('css-in-js')
      if (deps['tailwindcss']) this.frameworks.add('tailwindcss')
    }

    // Node.js frameworks
    if (deps?.['express']) this.frameworks.add('express')
    if (deps?.['next']) this.frameworks.add('nextjs')
    if (deps?.['@nestjs/core']) this.frameworks.add('nestjs')

    // Testing frameworks
    if (deps?.['jest']) this.frameworks.add('jest')
    if (deps?.['@testing-library/react']) this.frameworks.add('react-testing-library')
  }

  private detectPatterns() {
    for (const file of this.files) {
      if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) continue

      // Component patterns (React)
      if (file.content.includes('React.FC') || file.content.includes('React.Component')) {
        this.addPattern('component', file.path)
      }

      // Hook patterns
      if (file.content.includes('function use') || file.content.includes('const use')) {
        this.addPattern('hook', file.path)
      }

      // State management
      if (file.content.includes('createStore') || file.content.includes('useReducer')) {
        this.addPattern('state-management', file.path)
      }

      // API patterns
      if (file.content.includes('fetch(') || file.content.includes('axios.')) {
        this.addPattern('api-client', file.path)
      }

      // Error handling
      if (file.content.includes('try {') && file.content.includes('catch')) {
        this.addPattern('error-handling', file.path)
      }

      // Type definitions
      if (file.content.includes('interface ') || file.content.includes('type ')) {
        this.addPattern('type-definitions', file.path)
      }
    }
  }

  private addPattern(type: string, example: string) {
    if (!this.patterns.has(type)) {
      this.patterns.set(type, new Set())
    }
    this.patterns.get(type)!.add(example)
  }

  public analyze(): ProjectContext {
    return {
      dependencies: {
        production: Object.keys(this.packageJson.dependencies || {}),
        development: Object.keys(this.packageJson.devDependencies || {}),
        peer: Object.keys(this.packageJson.peerDependencies || {})
      },
      frameworks: Array.from(this.frameworks),
      patterns: Array.from(this.patterns.entries()).map(([type, examples]) => ({
        type,
        examples: Array.from(examples)
      })),
      fileTypes: Array.from(this.fileTypes.entries()).map(([ext, count]) => ({
        extension: ext,
        count
      }))
    }
  }

  /**
   * Checks if a dependency is available in the project
   */
  public hasDependency(name: string): boolean {
    return !!(
      this.packageJson.dependencies?.[name] ||
      this.packageJson.devDependencies?.[name] ||
      this.packageJson.peerDependencies?.[name]
    )
  }

  /**
   * Returns similar files that might be relevant for the target file
   */
  public findRelatedFiles(targetPath: string): string[] {
    const ext = path.extname(targetPath)
    const dir = path.dirname(targetPath)
    const base = path.basename(targetPath, ext)

    return this.files
      .filter(f => {
        // Same directory
        if (path.dirname(f.path) === dir) return true
        // Same base name (e.g. component and its test)
        if (path.basename(f.path, path.extname(f.path)) === base) return true
        // Index file in same directory
        if (f.path === path.join(dir, 'index' + ext)) return true
        return false
      })
      .map(f => f.path)
  }
}