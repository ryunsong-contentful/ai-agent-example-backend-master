import { ValidationResult } from './codeValidator'

interface AutoFix {
  pattern: RegExp
  replacement: string | ((match: string, ...groups: string[]) => string)
}

const commonFixes: AutoFix[] = [
  // Add missing type annotations
  {
    pattern: /\b(const|let|var)\s+(\w+)\s*=/g,
    replacement: (match, keyword, name) => `${keyword} ${name}: any =`
  },
  
  // Add error handling to promises
  {
    pattern: /async\s+function\s+(\w+)\s*\([^)]*\)\s*{([^}]*)}/g,
    replacement: (match, name, body) => 
      `async function ${name}(...args) {
        try {
          ${body}
        } catch (error) {
          console.error(\`Error in ${name}:\`, error);
          throw error;
        }
      }`
  },
  
  // Add input validation
  {
    pattern: /function\s+(\w+)\s*\(([^)]*)\)\s*{/g,
    replacement: (match, name, params) => {
      const paramList = params.split(',').map(p => p.trim()).filter(Boolean)
      const validations = paramList
        .map(p => `if (${p} === undefined) throw new Error("${p} is required");`)
        .join('\n    ')
      return `function ${name}(${params}) {\n    ${validations}\n`
    }
  },
  
  // Fix import formatting
  {
    pattern: /^import\s*{([^}]+)}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    replacement: (match, imports, module) => {
      const cleanImports = imports
        .split(',')
        .map((i: string) => i.trim())
        .filter(Boolean)
        .sort()
        .join(', ')
      return `import { ${cleanImports} } from '${module}';`
    }
  }
]

/**
 * Attempts to automatically fix common code quality issues
 */
export async function fixCommonIssues(content: string, validation: ValidationResult): Promise<string> {
  let fixedContent = content

  // Apply fixes based on validation errors
  for (const error of validation.errors) {
    const relevantFixes = commonFixes.filter(fix => {
      // Match fixes to error types
      if (error.type === 'pattern' && error.message.includes('type annotations')) {
        return fix.pattern.toString().includes('type annotations')
      }
      if (error.type === 'pattern' && error.message.includes('error handling')) {
        return fix.pattern.toString().includes('error handling')
      }
      if (error.type === 'pattern' && error.message.includes('input validation')) {
        return fix.pattern.toString().includes('input validation')
      }
      return false
    })

    // Apply relevant fixes
    for (const fix of relevantFixes) {
      fixedContent = fixedContent.replace(fix.pattern, fix.replacement as any)
    }
  }

  // Fix lint errors
  for (const error of validation.lintErrors) {
    if (error.rule === 'import/order') {
      // Fix import ordering
      const importFix = commonFixes.find(f => f.pattern.toString().includes('import'))
      if (importFix) {
        fixedContent = fixedContent.replace(importFix.pattern, importFix.replacement as any)
      }
    }
  }

  // Add missing type annotations for type errors
  for (const error of validation.typeErrors) {
    if (error.message.includes('implicitly has an \'any\' type')) {
      const typeFix = commonFixes.find(f => f.pattern.toString().includes('type annotations'))
      if (typeFix) {
        fixedContent = fixedContent.replace(typeFix.pattern, typeFix.replacement as any)
      }
    }
  }

  return fixedContent
}