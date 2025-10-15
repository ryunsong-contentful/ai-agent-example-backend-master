import { RepoFile } from './repoFetcher'
import * as ts from 'typescript'
import * as path from 'path'

interface FileImportGraph {
  [filepath: string]: {
    imports: string[]
    importedBy: string[]
    types: string[]
    exports: string[]
  }
}

export interface AnalysisResult {
  relevantFiles: string[]
  typeDefinitions: string[]
  relatedPatterns: string[]
}

export class ContextAnalyzer {
  private importGraph: FileImportGraph = {}
  private typeDefinitions: Set<string> = new Set()

  constructor(private files: RepoFile[]) {
    this.buildImportGraph()
  }

  private buildImportGraph() {
    this.files.forEach(file => {
      if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) return

      const sourceFile = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true
      )

      const fileInfo = {
        imports: [] as string[],
        importedBy: [] as string[],
        types: [] as string[],
        exports: [] as string[]
      }

      // Analyze imports and exports
      ts.forEachChild(sourceFile, node => {
        if (ts.isImportDeclaration(node)) {
          const importPath = (node.moduleSpecifier as ts.StringLiteral).text
          fileInfo.imports.push(this.resolveImportPath(file.path, importPath))
        }
        if (ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) {
            fileInfo.exports.push((node.moduleSpecifier as ts.StringLiteral).text)
          }
        }
        // Collect type definitions
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
          fileInfo.types.push(node.name.text)
          this.typeDefinitions.add(node.name.text)
        }
      })

      this.importGraph[file.path] = fileInfo
    })

    // Build importedBy relationships
    Object.entries(this.importGraph).forEach(([filePath, info]) => {
      info.imports.forEach(importPath => {
        if (this.importGraph[importPath]) {
          this.importGraph[importPath].importedBy.push(filePath)
        }
      })
    })
  }

  private resolveImportPath(currentFile: string, importPath: string): string {
    if (importPath.startsWith('.')) {
      return path.resolve(path.dirname(currentFile), importPath)
    }
    return importPath
  }

  public analyzeContext(targetFile: string, prompt: string): AnalysisResult {
    const relevantFiles = new Set<string>()
    const typeRefs = new Set<string>()

    // Add the target file and its direct dependencies
    relevantFiles.add(targetFile)
    const targetInfo = this.importGraph[targetFile]
    if (targetInfo) {
      targetInfo.imports.forEach(imp => relevantFiles.add(imp))
      targetInfo.importedBy.forEach(imp => relevantFiles.add(imp))
      targetInfo.types.forEach(t => typeRefs.add(t))
    }

    // Look for types mentioned in the prompt
    Array.from(this.typeDefinitions).forEach(type => {
      if (prompt.toLowerCase().includes(type.toLowerCase())) {
        // Find files that define or use this type
        Object.entries(this.importGraph).forEach(([file, info]) => {
          if (info.types.includes(type)) {
            relevantFiles.add(file)
            info.imports.forEach(imp => relevantFiles.add(imp))
          }
        })
      }
    })

    // Add files that share common types with our target file
    if (targetInfo) {
      targetInfo.types.forEach(type => {
        Object.entries(this.importGraph).forEach(([file, info]) => {
          if (info.types.includes(type)) {
            relevantFiles.add(file)
          }
        })
      })
    }

    // Determine which architectural patterns might be relevant
    const relatedPatterns = this.inferRelevantPatterns(prompt, Array.from(relevantFiles))

    return {
      relevantFiles: Array.from(relevantFiles),
      typeDefinitions: Array.from(typeRefs),
      relatedPatterns
    }
  }

  private inferRelevantPatterns(prompt: string, files: string[]): string[] {
    const patterns: string[] = []
    
    const keywords = {
      api: ['REST', 'API endpoints', 'HTTP handlers'],
      database: ['Repository pattern', 'Data access', 'Query handling'],
      auth: ['Authentication', 'Authorization', 'Security patterns'],
      validation: ['Input validation', 'Type checking', 'Schema validation'],
      testing: ['Unit testing', 'Integration testing', 'Test patterns']
    }

    // Check prompt and files for relevant patterns
    Object.entries(keywords).forEach(([category, categoryPatterns]) => {
      const hasRelevantCode = files.some(file => 
        this.files.find(f => f.path === file)?.content.toLowerCase()
          .includes(category.toLowerCase())
      )
      
      if (hasRelevantCode || prompt.toLowerCase().includes(category.toLowerCase())) {
        patterns.push(...categoryPatterns)
      }
    })

    return patterns
  }
}