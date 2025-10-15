import { ProjectAnalyzer } from './projectAnalyzer'
import { RepoFile } from './repoFetcher'
import * as ts from 'typescript'

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates that generated code changes are safe and compatible
 */
export class ChangeValidator {
  private analyzer: ProjectAnalyzer

  constructor(private files: RepoFile[]) {
    this.analyzer = new ProjectAnalyzer(files)
  }

  /**
   * Validates a proposed change against project constraints
   */
  public validateChange(originalContent: string, newContent: string, filePath: string): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for dependency usage
    const newDependencies = this.findNewDependencies(newContent, originalContent)
    for (const dep of newDependencies) {
      if (!this.analyzer.hasDependency(dep)) {
        errors.push(`Using unavailable dependency: ${dep}`)
      }
    }

    // Check for removed code
    const removedLines = this.findRemovedCode(originalContent, newContent)
    if (removedLines.length > 0) {
      warnings.push('Removing existing code - ensure functionality is preserved:')
      removedLines.forEach(line => warnings.push(`- ${line}`))
    }

    // Validate TypeScript syntax and imports
    const syntaxErrors = this.validateTypeScript(newContent, filePath)
    errors.push(...syntaxErrors)

    // Check size of changes
    const changeSize = this.calculateChangeSize(originalContent, newContent)
    if (changeSize > 0.5) { // If more than 50% changed
      warnings.push('Large code change detected - consider making smaller, incremental changes')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  private findNewDependencies(newContent: string, originalContent: string): string[] {
    const getImports = (content: string): Set<string> => {
      const imports = new Set<string>()
      try {
        const sourceFile = ts.createSourceFile(
          'temp.ts',
          content,
          ts.ScriptTarget.Latest,
          true
        )

        sourceFile.forEachChild(node => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const importPath = node.moduleSpecifier.text
            if (!importPath.startsWith('.')) {
              // Get the package name (everything before the first /)
              const packageName = importPath.split('/')[0]
              imports.add(packageName)
            }
          }
        })
      } catch (e) {
        console.warn('Failed to parse content for imports:', e)
      }
      return imports
    }

    const oldImports = getImports(originalContent)
    const newImports = getImports(newContent)

    return Array.from(newImports).filter(imp => !oldImports.has(imp))
  }

  private findRemovedCode(originalContent: string, newContent: string): string[] {
    const oldLines = new Set(originalContent.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('import') && !l.startsWith('//')))
    
    const newLines = new Set(newContent.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('import') && !l.startsWith('//')))

    return Array.from(oldLines).filter(l => !newLines.has(l))
  }

  private validateTypeScript(content: string, filePath: string): string[] {
    const errors: string[] = []
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      )

      // Create a simple program to do type checking
      const compilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.CommonJS,
        strict: true,
      }

      const host = ts.createCompilerHost(compilerOptions)
      const program = ts.createProgram([filePath], compilerOptions, host)
      
      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile)
      ]

      for (const diagnostic of diagnostics) {
        if (diagnostic.file) {
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!)
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
          errors.push(`${filePath}(${line + 1},${character + 1}): ${message}`)
        } else {
          errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        }
      }

      // Also validate imports
      sourceFile.forEachChild(node => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const importPath = node.moduleSpecifier.text
          if (!importPath.startsWith('.') && !this.analyzer.hasDependency(importPath.split('/')[0])) {
            errors.push(`Invalid import: ${importPath} is not available in the project`)
          }
        }
      })
    } catch (e) {
      errors.push(`Failed to validate TypeScript: ${e}`)
    }
    return errors
  }

  private calculateChangeSize(originalContent: string, newContent: string): number {
    const oldLines = originalContent.split('\n').filter(l => l.trim())
    const newLines = newContent.split('\n').filter(l => l.trim())
    const changes = newLines.filter(l => !oldLines.includes(l)).length
    return changes / oldLines.length
  }
}