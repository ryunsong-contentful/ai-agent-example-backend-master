import * as ts from 'typescript'
import * as ESLint from 'eslint'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  typeErrors: TypeCheckError[]
  lintErrors: LintError[]
}

interface ValidationError {
  type: 'type' | 'lint' | 'pattern'
  message: string
  line?: number
  column?: number
  file: string
}

interface TypeCheckError {
  message: string
  line: number
  column: number
  file: string
}

interface LintError {
  message: string
  line: number
  column: number
  rule: string
  severity: number
  file: string
}

export class CodeValidator {
  private compiler: ts.Program
  private eslint: ESLint.ESLint
  private compilerOptions: ts.CompilerOptions

  constructor(private projectRoot: string) {
    // Load TypeScript configuration
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
    this.compilerOptions = ts.convertCompilerOptionsFromJson(
      tsconfig.compilerOptions,
      projectRoot
    ).options

    // Initialize ESLint
    this.eslint = new ESLint.ESLint({
      useEslintrc: true,
      cwd: projectRoot
    })

    // Create TypeScript program
    this.compiler = ts.createProgram([], this.compilerOptions)
  }

  public async validateCode(filePath: string, content: string): Promise<ValidationResult> {
    const errors: ValidationError[] = []
    const typeErrors: TypeCheckError[] = []
    const lintErrors: LintError[] = []

    // Type checking
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      this.compilerOptions.target || ts.ScriptTarget.Latest,
      true
    )

    const diagnostics = [
      ...ts.getPreEmitDiagnostics(this.compiler, sourceFile),
      ...this.compiler.getSemanticDiagnostics(sourceFile),
      ...this.compiler.getSyntacticDiagnostics(sourceFile)
    ]

    for (const diagnostic of diagnostics) {
      if (diagnostic.file) {
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!)
        typeErrors.push({
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          line: line + 1,
          column: character + 1,
          file: filePath
        })
      }
    }

    // Lint checking
    try {
      const lintResults = await this.eslint.lintText(content, { filePath })
      for (const result of lintResults) {
        lintErrors.push(...result.messages.map(msg => ({
          message: msg.message,
          line: msg.line,
          column: msg.column,
          rule: msg.ruleId || 'unknown',
          severity: msg.severity,
          file: filePath
        })))
      }
    } catch (error) {
      errors.push({
        type: 'lint',
        message: `ESLint error: ${error}`,
        file: filePath
      })
    }

    // Pattern validation
    const patternErrors = this.validatePatterns(content, filePath)
    errors.push(...patternErrors)

    const isValid = typeErrors.length === 0 && 
                   lintErrors.filter(e => e.severity === 2).length === 0 &&
                   errors.length === 0

    return {
      valid: isValid,
      errors,
      typeErrors,
      lintErrors
    }
  }

  private validatePatterns(content: string, filePath: string): ValidationError[] {
    const errors: ValidationError[] = []
    
    // Check for required patterns
    const patterns = {
      errorHandling: /try\s*{[\s\S]*?}\s*catch\s*\([^)]+\)\s*{/,
      typeAnnotations: /:\s*[A-Z][A-Za-z0-9]+([\[\]<>]|$)/,
      asyncAwait: /async\s+.*?\bawait\b/,
      inputValidation: /\b(validate|check|assert|ensure)\b.*?\(/,
      importStatements: /^import\s+.*\s+from\s+['"][^'"]+['"];?\s*$/m
    }

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      if (!patterns.errorHandling.test(content)) {
        errors.push({
          type: 'pattern',
          message: 'Missing error handling pattern (try-catch blocks)',
          file: filePath
        })
      }

      if (!patterns.typeAnnotations.test(content)) {
        errors.push({
          type: 'pattern',
          message: 'Missing type annotations',
          file: filePath
        })
      }

      if (content.includes('Promise') && !patterns.asyncAwait.test(content)) {
        errors.push({
          type: 'pattern',
          message: 'Promises should use async/await pattern',
          file: filePath
        })
      }

      // Check for input validation in functions that take parameters
      if (content.includes('function') && !patterns.inputValidation.test(content)) {
        errors.push({
          type: 'pattern',
          message: 'Missing input validation in functions',
          file: filePath
        })
      }

      // Verify import statement formatting
      const importLines = content.match(/^import.*$/gm) || []
      for (const line of importLines) {
        if (!patterns.importStatements.test(line)) {
          errors.push({
            type: 'pattern',
            message: 'Invalid import statement format',
            file: filePath
          })
        }
      }
    }

    return errors
  }
}