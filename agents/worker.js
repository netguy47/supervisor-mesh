/**
 * Worker Agent
 * 
 * Executes steps from the plan and applies diffs.
 * Handles file operations, tool invocations, and skill execution.
 */

const { v4: uuidv4 } = require('crypto').randomUUID;
const fs = require('fs').promises;
const path = require('path');

class WorkerAgent {
  constructor(engine, config = {}) {
    this.engine = engine;
    this.name = 'worker';
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000, // 1 second
      enableDiffTracking: config.enableDiffTracking !== false,
      timeout: config.timeout || 300000, // 5 minutes
      ...config
    };
    
    this.executionHistory = [];
    this.currentExecution = null;
    
    this.engine.log('Worker agent initialized', 'info');
  }

  /**
   * Execute a step
   */
  async execute(step, context = {}) {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.engine.log(`[Worker] Executing step: ${step.id} - ${step.description}`, 'info');

    this.currentExecution = {
      id: correlationId,
      stepId: step.id,
      step,
      context,
      startTime,
      status: 'executing',
      diffs: [],
      output: {},
      attempts: 0
    };

    try {
      let result;
      let attempt = 0;
      let lastError = null;

      // Retry logic
      while (attempt <= this.config.maxRetries) {
        try {
          attempt++;
          this.currentExecution.attempts = attempt;

          // Execute based on action type
          switch (step.action) {
            case 'create':
              result = await this.executeCreate(step, context);
              break;
            case 'update':
              result = await this.executeUpdate(step, context);
              break;
            case 'delete':
              result = await this.executeDelete(step, context);
              break;
            case 'execute':
              result = await this.executeAction(step, context);
              break;
            default:
              throw new Error(`Unknown action type: ${step.action}`);
          }

          // Success - break out of retry loop
          break;

        } catch (error) {
          lastError = error;
          this.engine.log(`[Worker] Attempt ${attempt} failed for step ${step.id}: ${error.message}`, 'warn');

          if (attempt < this.config.maxRetries) {
            // Exponential backoff
            await new Promise(resolve => 
              setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt - 1))
            );
          } else {
            // Max retries reached
            throw error;
          }
        }
      }

      const duration = Date.now() - startTime;
      this.currentExecution.status = 'completed';
      this.currentExecution.duration = duration;

      this.engine.log(`[Worker] Step ${step.id} completed in ${duration}ms`, 'info');

      // Record execution history
      this.executionHistory.push({
        ...this.currentExecution,
        timestamp: new Date().toISOString()
      });

      const response = {
        type: 'ExecutionResult',
        from: 'worker',
        to: 'supervisor',
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          status: 'success',
          stepId: step.id,
          duration: this.formatDuration(duration),
          output: result,
          diffs: this.currentExecution.diffs
        }
      };

      this.currentExecution = null;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.currentExecution.status = 'failed';
      this.currentExecution.duration = duration;
      this.currentExecution.error = error.message;

      this.engine.log(`[Worker] Step ${step.id} failed: ${error.message}`, 'error');

      const response = {
        type: 'ExecutionResult',
        from: 'worker',
        to: 'supervisor',
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          status: 'error',
          stepId: step.id,
          duration: this.formatDuration(duration),
          error: error.message,
          attempts: this.currentExecution.attempts,
          diffs: this.currentExecution.diffs
        }
      };

      this.currentExecution = null;
      return response;
    }
  }

  /**
   * Execute create action
   */
  async executeCreate(step, context) {
    if (step.target.type === 'file') {
      return await this.createFile(step, context);
    } else if (step.target.type === 'skill') {
      return await this.executeSkill(step, context);
    } else {
      throw new Error(`Unsupported create target type: ${step.target.type}`);
    }
  }

  /**
   * Execute update action
   */
  async executeUpdate(step, context) {
    if (step.target.type === 'file') {
      return await this.updateFile(step, context);
    } else {
      throw new Error(`Unsupported update target type: ${step.target.type}`);
    }
  }

  /**
   * Execute delete action
   */
  async executeDelete(step, context) {
    if (step.target.type === 'file') {
      return await this.deleteFile(step, context);
    } else {
      throw new Error(`Unsupported delete target type: ${step.target.type}`);
    }
  }

  /**
   * Execute action
   */
  async executeAction(step, context) {
    if (step.target.type === 'file') {
      return await this.readFile(step, context);
    } else if (step.target.type === 'search') {
      return await this.searchFiles(step, context);
    } else if (step.target.type === 'command') {
      return await this.runCommand(step, context);
    } else if (step.target.type === 'skill') {
      return await this.executeSkill(step, context);
    } else if (step.target.type === 'analysis') {
      return await this.performAnalysis(step, context);
    } else {
      return await this.executeGenericAction(step, context);
    }
  }

  /**
   * Create a file with diff tracking
   */
  async createFile(step, context) {
    const filePath = this.engine.resolvePath(step.target.path);
    const content = context.content || this.generateContent(step, context);

    // Read original (should not exist)
    let originalContent = '';
    try {
      originalContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      // File doesn't exist, that's expected
    }

    // Write file
    await this.engine.executeTool('file-write', {
      path: filePath,
      content: content
    });

    // Track diff
    if (this.config.enableDiffTracking) {
      const diff = this.generateDiff(originalContent, content, filePath, 'create');
      this.currentExecution.diffs.push(diff);
    }

    return {
      file: filePath,
      created: true,
      size: content.length
    };
  }

  /**
   * Update a file with diff tracking (Antigravity Editor style)
   */
  async updateFile(step, context) {
    const filePath = this.engine.resolvePath(step.target.path);

    // Read original content
    const originalContent = await this.engine.executeTool('file-read', {
      path: filePath
    });

    // Apply changes
    let newContent = originalContent;
    
    if (context.changes) {
      // Apply specific changes
      newContent = this.applyChanges(originalContent, context.changes);
    } else if (context.newContent) {
      // Replace entire content
      newContent = context.newContent;
    } else {
      // Generate content based on step
      newContent = this.generateContent(step, context);
    }

    // Write updated content
    await this.engine.executeTool('file-write', {
      path: filePath,
      content: newContent
    });

    // Track diff
    if (this.config.enableDiffTracking) {
      const diff = this.generateDiff(originalContent, newContent, filePath, 'update');
      this.currentExecution.diffs.push(diff);
    }

    return {
      file: filePath,
      updated: true,
      changes: context.changes || 'Full content update'
    };
  }

  /**
   * Delete a file with diff tracking
   */
  async deleteFile(step, context) {
    const filePath = this.engine.resolvePath(step.target.path);

    // Read original content before deletion
    let originalContent = '';
    try {
      originalContent = await this.engine.executeTool('file-read', {
        path: filePath
      });
    } catch (error) {
      // File doesn't exist
    }

    // Delete file
    await this.engine.executeTool('file-delete', {
      path: filePath
    });

    // Track diff
    if (this.config.enableDiffTracking) {
      const diff = this.generateDiff(originalContent, '', filePath, 'delete');
      this.currentExecution.diffs.push(diff);
    }

    return {
      file: filePath,
      deleted: true
    };
  }

  /**
   * Read a file
   */
  async readFile(step, context) {
    const filePath = this.engine.resolvePath(step.target.path);
    const content = await this.engine.executeTool('file-read', {
      path: filePath
    });

    return {
      file: filePath,
      content: content,
      size: content.length,
      lines: content.split('\n').length
    };
  }

  /**
   * Search for files
   */
  async searchFiles(step, context) {
    const searchPath = context.path || '.';
    const pattern = context.pattern || step.target.query || '*';
    
    const results = await this.engine.executeTool('file-search', {
      path: searchPath,
      pattern: pattern
    });

    return {
      query: pattern,
      path: searchPath,
      results: results,
      count: results.length
    };
  }

  /**
   * Run a command
   */
  async runCommand(step, context) {
    const command = context.command || step.target.command;
    const cwd = context.cwd || '.';

    const result = await this.engine.executeTool('execute-command', {
      command: command,
      cwd: cwd
    });

    return {
      command: command,
      cwd: cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.success
    };
  }

  /**
   * Execute a skill
   */
  async executeSkill(step, context) {
    const skillName = step.target.name;
    const skill = this.engine.getSkill(skillName);

    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    // In a full implementation, this would integrate with the skill system
    // For now, we'll simulate skill execution
    this.engine.log(`[Worker] Executing skill: ${skillName}`, 'info');

    return {
      skill: skillName,
      executed: true,
      description: skill.description,
      note: 'Skill execution would be integrated with Desktop Commander skills system'
    };
  }

  /**
   * Perform analysis
   */
  async performAnalysis(step, context) {
    const analysis = {
      target: step.target.details,
      timestamp: new Date().toISOString(),
      findings: []
    };

    // Simple analysis - in a full implementation this would be more sophisticated
    analysis.findings.push({
      type: 'info',
      message: `Analysis requested for: ${step.target.details}`
    });

    return analysis;
  }

  /**
   * Execute a generic action
   */
  async executeGenericAction(step, context) {
    // This is a placeholder for actions that don't fit other categories
    return {
      action: step.action,
      target: step.target.details,
      executed: true,
      note: 'Generic action executed'
    };
  }

  /**
   * Generate content for a file
   */
  generateContent(step, context) {
    // This is a simplified content generator
    // In a full implementation, this would use LLM generation
    return `// Generated content for: ${step.description}\n// Generated at: ${new Date().toISOString()}\n`;
  }

  /**
   * Apply changes to content (Antigravity Editor style)
   */
  applyChanges(original, changes) {
    let content = original;

    if (changes.prepend) {
      content = changes.prepend + '\n' + content;
    }

    if (changes.append) {
      content = content + '\n' + changes.append;
    }

    if (changes.replace) {
      for (const replacement of changes.replace) {
        content = content.replace(replacement.from, replacement.to);
      }
    }

    if (changes.insertBefore) {
      for (const insertion of changes.insertBefore) {
        const before = insertion.before;
        const text = insertion.text;
        content = content.replace(before, text + '\n' + before);
      }
    }

    if (changes.insertAfter) {
      for (const insertion of changes.insertAfter) {
        const after = insertion.after;
        const text = insertion.text;
        content = content.replace(after, after + '\n' + text);
      }
    }

    return content;
  }

  /**
   * Generate a diff between original and new content
   */
  generateDiff(original, modified, filePath, operation) {
    const linesOriginal = original.split('\n');
    const linesModified = modified.split('\n');

    let diffContent = '';
    let lineNum = 1;

    // Simple unified diff
    diffContent += `--- ${filePath}\n`;
    diffContent += `+++ ${filePath}\n`;
    diffContent += `@@ -0,0 +1,${linesModified.length} @@\n`;

    if (operation === 'create') {
      for (const line of linesModified) {
        diffContent += `+${line}\n`;
      }
    } else if (operation === 'delete') {
      for (const line of linesOriginal) {
        diffContent += `-${line}\n`;
      }
    } else if (operation === 'update') {
      // Simple comparison - in a full implementation, use a proper diff algorithm
      const maxLength = Math.max(linesOriginal.length, linesModified.length);
      
      for (let i = 0; i < maxLength; i++) {
        const originalLine = linesOriginal[i] || '';
        const modifiedLine = linesModified[i] || '';

        if (originalLine === modifiedLine) {
          diffContent += ` ${originalLine}\n`;
        } else {
          if (originalLine) {
            diffContent += `-${originalLine}\n`;
          }
          if (modifiedLine) {
            diffContent += `+${modifiedLine}\n`;
          }
        }
      }
    }

    return {
      path: filePath,
      operation: operation,
      changes: diffContent.trim(),
      linesAdded: linesModified.length,
      linesRemoved: linesOriginal.length
    };
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get execution history
   */
  getHistory() {
    return this.executionHistory;
  }

  /**
   * Clear execution history
   */
  clearHistory() {
    this.executionHistory = [];
  }

  /**
   * Get current execution
   */
  getCurrentExecution() {
    return this.currentExecution;
  }

  /**
   * Cancel current execution
   */
  cancelCurrentExecution() {
    if (this.currentExecution && this.currentExecution.status === 'executing') {
      this.currentExecution.status = 'cancelled';
      this.engine.log(`[Worker] Execution ${this.currentExecution.id} cancelled`, 'warn');
      return true;
    }
    return false;
  }
}

module.exports = WorkerAgent;
