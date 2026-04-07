/**
 * Engine Module
 * 
 * Coordinates skills, workflows, and tools across the Supervisor Mesh.
 * Provides core infrastructure for all agents.
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('crypto').randomUUID;

class Engine {
  constructor(config = {}) {
    this.config = {
      skillsPath: config.skillsPath || path.join(__dirname, '..', '.desktop-commander', 'skills'),
      workspacePath: config.workspacePath || process.cwd(),
      outputDir: config.outputDir || path.join(process.cwd(), 'output'),
      maxConcurrentOperations: config.maxConcurrentOperations || 3,
      logLevel: config.logLevel || 'info',
      ...config
    };

    this.skills = new Map();
    this.tools = new Map();
    this.workflows = new Map();
    this.activeOperations = new Map();
    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      operationHistory: []
    };

    this.init();
  }

  async init() {
    await this.ensureDirectories();
    await this.loadSkills();
    await this.registerDefaultTools();
    this.log('Engine initialized', 'info');
  }

  async ensureDirectories() {
    const dirs = [this.config.outputDir];
    for (const dir of dirs) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  /**
   * Load available skills from skills directory
   */
  async loadSkills() {
    try {
      const skillsDir = this.config.skillsPath;
      try {
        await fs.access(skillsDir);
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
            try {
              const content = await fs.readFile(skillPath, 'utf-8');
              this.skills.set(entry.name, {
                name: entry.name,
                path: path.join(skillsDir, entry.name),
                description: this.extractDescription(content),
                triggers: this.extractTriggers(content),
                content: content
              });
            } catch (error) {
              this.log(`Could not load skill ${entry.name}: ${error.message}`, 'warn');
            }
          }
        }
      } catch (error) {
        // Skills directory doesn't exist yet, that's okay
        this.log(`Skills directory not accessible: ${error.message}`, 'warn');
      }
      
      this.log(`Loaded ${this.skills.size} skills`, 'info');
    } catch (error) {
      this.log(`Error loading skills: ${error.message}`, 'error');
    }
  }

  extractDescription(content) {
    const descMatch = content.match(/Skill description:\s*"([^"]+)"/);
    return descMatch ? descMatch[1] : 'No description available';
  }

  extractTriggers(content) {
    const triggers = [];
    const triggerMatch = content.match(/Triggers?:\s*\n((?:-\s+[^\n]+\n?)+)/);
    if (triggerMatch) {
      const lines = triggerMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/-\s*(.+)/);
        if (match) triggers.push(match[1].trim());
      }
    }
    return triggers;
  }

  /**
   * Register default tools
   */
  async registerDefaultTools() {
    const defaultTools = [
      {
        name: 'file-read',
        description: 'Read file contents',
        execute: async (params) => {
          const filePath = this.resolvePath(params.path);
          return await fs.readFile(filePath, 'utf-8');
        }
      },
      {
        name: 'file-write',
        description: 'Write content to file',
        execute: async (params) => {
          const filePath = this.resolvePath(params.path);
          const dir = path.dirname(filePath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, params.content, 'utf-8');
          return { success: true, path: filePath };
        }
      },
      {
        name: 'file-exists',
        description: 'Check if file exists',
        execute: async (params) => {
          const filePath = this.resolvePath(params.path);
          try {
            await fs.access(filePath);
            return { exists: true, path: filePath };
          } catch {
            return { exists: false, path: filePath };
          }
        }
      },
      {
        name: 'file-delete',
        description: 'Delete a file',
        execute: async (params) => {
          const filePath = this.resolvePath(params.path);
          await fs.unlink(filePath);
          return { success: true, path: filePath };
        }
      },
      {
        name: 'file-list',
        description: 'List files in directory',
        execute: async (params) => {
          const dirPath = this.resolvePath(params.path || '.');
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          return entries.map(entry => ({
            name: entry.name,
            path: path.join(dirPath, entry.name),
            isDirectory: entry.isDirectory()
          }));
        }
      },
      {
        name: 'file-search',
        description: 'Search for files by pattern',
        execute: async (params) => {
          const results = [];
          const searchDir = this.resolvePath(params.path || '.');
          const pattern = new RegExp(params.pattern, params.flags || 'i');
          
          await this.searchRecursive(searchDir, pattern, results);
          return results;
        }
      },
      {
        name: 'json-parse',
        description: 'Parse JSON string',
        execute: async (params) => {
          return JSON.parse(params.json);
        }
      },
      {
        name: 'json-stringify',
        description: 'Convert object to JSON',
        execute: async (params) => {
          return JSON.stringify(params.obj, null, params.indent || 2);
        }
      },
      {
        name: 'execute-command',
        description: 'Execute shell command (Windows compatible)',
        execute: async (params) => {
          return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            const command = this.adaptCommandForWindows(params.command);
            
            exec(command, { 
              cwd: this.resolvePath(params.cwd || '.'),
              maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            }, (error, stdout, stderr) => {
              if (error) {
                reject({ error: error.message, code: error.code });
              } else {
                resolve({ 
                  success: true, 
                  stdout: stdout.trim(), 
                  stderr: stderr.trim() 
                });
              }
            });
          });
        }
      },
      {
        name: 'wait',
        description: 'Wait for specified duration',
        execute: async (params) => {
          const duration = params.duration || 1000;
          await new Promise(resolve => setTimeout(resolve, duration));
          return { success: true, waited: duration };
        }
      }
    ];

    for (const tool of defaultTools) {
      this.tools.set(tool.name, tool);
    }

    this.log(`Registered ${this.tools.size} default tools`, 'info');
  }

  /**
   * Register a custom tool
   */
  registerTool(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error('Tool must have name and execute function');
    }
    this.tools.set(tool.name, tool);
    this.log(`Registered tool: ${tool.name}`, 'info');
  }

  /**
   * Get tool by name
   */
  getTool(name) {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool with parameters
   */
  async executeTool(name, params = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const operationId = uuidv4();
    this.activeOperations.set(operationId, {
      name,
      params,
      startTime: Date.now(),
      status: 'executing'
    });

    try {
      this.metrics.totalOperations++;
      const result = await tool.execute(params);
      this.metrics.successfulOperations++;
      
      this.activeOperations.set(operationId, {
        ...this.activeOperations.get(operationId),
        status: 'completed',
        endTime: Date.now(),
        result
      });

      return result;
    } catch (error) {
      this.metrics.failedOperations++;
      
      this.activeOperations.set(operationId, {
        ...this.activeOperations.get(operationId),
        status: 'failed',
        endTime: Date.now(),
        error: error.message
      });

      throw error;
    } finally {
      // Keep operation history limited to last 100
      if (this.metrics.operationHistory.length > 100) {
        this.metrics.operationHistory.shift();
      }
    }
  }

  /**
   * Get skill by name
   */
  getSkill(name) {
    return this.skills.get(name);
  }

  /**
   * Find skill by trigger
   */
  findSkillByTrigger(trigger) {
    for (const [name, skill] of this.skills) {
      if (skill.triggers.some(t => 
        trigger.toLowerCase().includes(t.toLowerCase()) ||
        t.toLowerCase().includes(trigger.toLowerCase())
      )) {
        return skill;
      }
    }
    return null;
  }

  /**
   * Get all skills
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * Register a workflow
   */
  registerWorkflow(name, workflow) {
    if (!name || !workflow.steps || !Array.isArray(workflow.steps)) {
      throw new Error('Workflow must have name and steps array');
    }
    this.workflows.set(name, workflow);
    this.log(`Registered workflow: ${name}`, 'info');
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(name, context = {}) {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow not found: ${name}`);
    }

    const results = [];
    for (const step of workflow.steps) {
      try {
        const result = await this.executeTool(step.tool, {
          ...step.params,
          ...context
        });
        results.push({ step: step.name, result });
      } catch (error) {
        if (workflow.continueOnError) {
          results.push({ step: step.name, error: error.message });
        } else {
          throw new Error(`Workflow failed at step ${step.name}: ${error.message}`);
        }
      }
    }

    return results;
  }

  /**
   * Resolve path relative to workspace
   */
  resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    // Convert to forward slashes for cross-platform compatibility
    return path.join(this.config.workspacePath, filePath).replace(/\\/g, '/');
  }

  /**
   * Adapt command for Windows if needed
   */
  adaptCommandForWindows(command) {
    if (process.platform === 'win32') {
      // Convert unix-style commands if needed
      return command
        .replace(/ls -la/g, 'dir')
        .replace(/rm -rf/g, 'rd /s /q');
    }
    return command;
  }

  /**
   * Recursive file search
   */
  async searchRecursive(dir, pattern, results) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this.searchRecursive(fullPath, pattern, results);
        } else if (pattern.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't access
    }
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeOperations: Array.from(this.activeOperations.values()),
      successRate: this.metrics.totalOperations > 0 
        ? (this.metrics.successfulOperations / this.metrics.totalOperations * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      operationHistory: []
    };
    this.activeOperations.clear();
  }

  /**
   * Log message
   */
  log(message, level = 'info') {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = levels[this.config.logLevel] || levels.info;
    
    if (levels[level] >= currentLevel) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Shutdown engine
   */
  async shutdown() {
    this.log('Shutting down engine...', 'info');
    // Wait for active operations to complete
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeOperations.size > 0 && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.log('Engine shutdown complete', 'info');
  }
}

module.exports = Engine;
