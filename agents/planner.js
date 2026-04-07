/**
 * Planner Agent
 * 
 * Analyzes goals and generates step-by-step execution plans.
 * Identifies required tools, skills, and dependencies.
 */

const { v4: uuidv4 } = require('crypto').randomUUID;

class PlannerAgent {
  constructor(engine, config = {}) {
    this.engine = engine;
    this.name = 'planner';
    this.config = {
      maxSteps: config.maxSteps || 10,
      maxPlanDuration: config.maxPlanDuration || 3600000, // 1 hour
      enableRetry: config.enableRetry !== false,
      ...config
    };
    
    this.planningHistory = [];
    this.patterns = this.initializePatterns();
    
    this.engine.log('Planner agent initialized', 'info');
  }

  /**
   * Initialize planning patterns
   */
  initializePatterns() {
    return {
      'create-file': {
        description: 'Create a new file',
        action: 'create',
        estimatedDuration: '1m',
        requiredTools: ['file-write']
      },
      'update-file': {
        description: 'Update existing file',
        action: 'update',
        estimatedDuration: '2m',
        requiredTools: ['file-read', 'file-write']
      },
      'delete-file': {
        description: 'Delete a file',
        action: 'delete',
        estimatedDuration: '1m',
        requiredTools: ['file-delete']
      },
      'read-file': {
        description: 'Read file contents',
        action: 'execute',
        estimatedDuration: '30s',
        requiredTools: ['file-read']
      },
      'search-files': {
        description: 'Search for files',
        action: 'execute',
        estimatedDuration: '2m',
        requiredTools: ['file-search']
      },
      'run-command': {
        description: 'Execute a command',
        action: 'execute',
        estimatedDuration: '5m',
        requiredTools: ['execute-command']
      },
      'use-skill': {
        description: 'Use a specific skill',
        action: 'execute',
        estimatedDuration: '10m',
        requiredSkills: true
      }
    };
  }

  /**
   * Plan request handler
   */
  async plan(goal, context = {}, constraints = {}) {
    const correlationId = uuidv4();
    this.engine.log(`[Planner] Planning goal: ${goal}`, 'info');

    const startTime = Date.now();

    try {
      // Parse and analyze the goal
      const analysis = await this.analyzeGoal(goal, context);
      
      // Generate plan based on analysis
      const plan = await this.generatePlan(analysis, constraints);
      
      // Validate the plan
      const validatedPlan = await this.validatePlan(plan);
      
      const duration = Date.now() - startTime;

      this.engine.log(`[Planner] Plan generated with ${plan.steps.length} steps in ${duration}ms`, 'info');

      // Record planning history
      this.planningHistory.push({
        id: correlationId,
        goal,
        plan: validatedPlan,
        timestamp: new Date().toISOString(),
        duration
      });

      return {
        type: 'PlanResponse',
        from: 'planner',
        to: 'supervisor',
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          status: 'success',
          plan: validatedPlan,
          analysis
        }
      };

    } catch (error) {
      this.engine.log(`[Planner] Planning failed: ${error.message}`, 'error');
      
      return {
        type: 'PlanResponse',
        from: 'planner',
        to: 'supervisor',
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          status: 'error',
          error: error.message,
          suggestions: this.generateErrorSuggestions(error)
        }
      };
    }
  }

  /**
   * Analyze the goal to understand requirements
   */
  async analyzeGoal(goal, context) {
    const analysis = {
      goal: goal,
      intent: this.detectIntent(goal),
      entities: this.extractEntities(goal),
      complexity: this.assessComplexity(goal),
      requirements: [],
      constraints: []
    };

    // Check for matching skills
    const matchingSkill = this.engine.findSkillByTrigger(goal);
    if (matchingSkill) {
      analysis.recommendedSkill = matchingSkill.name;
      analysis.requirements.push('skill:' + matchingSkill.name);
    }

    // Analyze context for additional information
    if (context.files) {
      analysis.entities.files = context.files;
    }

    return analysis;
  }

  /**
   * Detect the primary intent of the goal
   */
  detectIntent(goal) {
    const lowerGoal = goal.toLowerCase();
    
    const intents = {
      'create': /create|make|new|build|generate|add/i,
      'update': /update|modify|change|edit|fix|improve/i,
      'delete': /delete|remove|clear|erase/i,
      'read': /read|get|show|display|list/i,
      'search': /find|search|look for|locate/i,
      'execute': /run|execute|perform|do|start/i,
      'analyze': /analyze|review|check|verify|test/i
    };

    for (const [intent, pattern] of Object.entries(intents)) {
      if (pattern.test(lowerGoal)) {
        return intent;
      }
    }

    return 'unknown';
  }

  /**
   * Extract entities from the goal
   */
  extractEntities(goal) {
    const entities = {
      files: [],
      directories: [],
      commands: [],
      skills: []
    };

    // Extract file paths
    const filePattern = /["']?([a-zA-Z]:\\[^"']+|\/[^"']+\.[a-zA-Z]{2,4})["']?/g;
    let match;
    while ((match = filePattern.exec(goal)) !== null) {
      entities.files.push(match[1]);
    }

    // Extract quoted strings (might be skill names)
    const quotedPattern = /"([^"]+)"/g;
    while ((match = quotedPattern.exec(goal)) !== null) {
      const value = match[1];
      if (this.engine.getSkill(value)) {
        entities.skills.push(value);
      }
    }

    return entities;
  }

  /**
   * Assess the complexity of the goal
   */
  assessComplexity(goal) {
    const indicators = {
      length: goal.length,
      sentences: goal.split(/[.!?]+/).length,
      conjunctions: (goal.match(/\b(and|or|but|then|also)\b/gi) || []).length,
      multipleActions: (goal.match(/\b(create|update|delete|read|search|run|execute)\b/gi) || []).length
    };

    let score = 0;
    score += indicators.length > 100 ? 2 : indicators.length > 50 ? 1 : 0;
    score += indicators.sentences > 2 ? 2 : indicators.sentences > 1 ? 1 : 0;
    score += indicators.conjunctions > 2 ? 2 : indicators.conjunctions > 0 ? 1 : 0;
    score += indicators.multipleActions > 1 ? 2 : indicators.multipleActions > 0 ? 1 : 0;

    if (score <= 2) return 'simple';
    if (score <= 5) return 'moderate';
    return 'complex';
  }

  /**
   * Generate a plan based on analysis
   */
  async generatePlan(analysis, constraints) {
    const steps = [];
    let stepId = 1;

    // If a skill is recommended, use it as the primary action
    if (analysis.recommendedSkill) {
      steps.push({
        id: `step-${stepId++}`,
        description: `Execute skill: ${analysis.recommendedSkill}`,
        action: 'execute',
        target: {
          type: 'skill',
          name: analysis.recommendedSkill
        },
        dependencies: [],
        estimatedDuration: '10m',
        requiredSkills: [analysis.recommendedSkill]
      });

      return {
        id: `plan-${uuidv4()}`,
        goal: analysis.goal,
        steps,
        totalEstimatedDuration: '10m',
        complexity: analysis.complexity,
        recommendedSkill: analysis.recommendedSkill
      };
    }

    // Generate steps based on intent
    switch (analysis.intent) {
      case 'create':
        steps.push(...this.generateCreateSteps(analysis, stepId));
        break;
      case 'update':
        steps.push(...this.generateUpdateSteps(analysis, stepId));
        break;
      case 'delete':
        steps.push(...this.generateDeleteSteps(analysis, stepId));
        break;
      case 'read':
        steps.push(...this.generateReadSteps(analysis, stepId));
        break;
      case 'search':
        steps.push(...this.generateSearchSteps(analysis, stepId));
        break;
      case 'execute':
        steps.push(...this.generateExecuteSteps(analysis, stepId));
        break;
      case 'analyze':
        steps.push(...this.generateAnalyzeSteps(analysis, stepId));
        break;
      default:
        steps.push(...this.generateGenericSteps(analysis, stepId));
    }

    // Apply constraints
    const constrainedSteps = this.applyConstraints(steps, constraints);

    return {
      id: `plan-${uuidv4()}`,
      goal: analysis.goal,
      steps: constrainedSteps,
      totalEstimatedDuration: this.calculateTotalDuration(constrainedSteps),
      complexity: analysis.complexity
    };
  }

  /**
   * Generate steps for create intent
   */
  generateCreateSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    // If files are mentioned, create them
    if (analysis.entities.files.length > 0) {
      for (const file of analysis.entities.files) {
        steps.push({
          id: `step-${stepId++}`,
          description: `Create file: ${file}`,
          action: 'create',
          target: {
            type: 'file',
            path: file
          },
          dependencies: [],
          estimatedDuration: '1m',
          requiredTools: ['file-write']
        });
      }
    } else {
      // Generic create step
      steps.push({
        id: `step-${stepId++}`,
        description: `Create resource for: ${analysis.goal}`,
        action: 'create',
        target: {
          type: 'unknown',
          details: analysis.goal
        },
        dependencies: [],
        estimatedDuration: '5m',
        requiredTools: []
      });
    }

    return steps;
  }

  /**
   * Generate steps for update intent
   */
  generateUpdateSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    // If files are mentioned, update them
    if (analysis.entities.files.length > 0) {
      for (const file of analysis.entities.files) {
        steps.push({
          id: `step-${stepId++}`,
          description: `Read file: ${file}`,
          action: 'execute',
          target: {
            type: 'file',
            path: file
          },
          dependencies: [],
          estimatedDuration: '30s',
          requiredTools: ['file-read']
        });
        
        steps.push({
          id: `step-${stepId++}`,
          description: `Update file: ${file}`,
          action: 'update',
          target: {
            type: 'file',
            path: file
          },
          dependencies: [`step-${stepId - 2}`],
          estimatedDuration: '2m',
          requiredTools: ['file-read', 'file-write']
        });
      }
    } else {
      // Generic update step
      steps.push({
        id: `step-${stepId++}`,
        description: `Update: ${analysis.goal}`,
        action: 'update',
        target: {
          type: 'unknown',
          details: analysis.goal
        },
        dependencies: [],
        estimatedDuration: '5m',
        requiredTools: []
      });
    }

    return steps;
  }

  /**
   * Generate steps for delete intent
   */
  generateDeleteSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    if (analysis.entities.files.length > 0) {
      for (const file of analysis.entities.files) {
        steps.push({
          id: `step-${stepId++}`,
          description: `Delete file: ${file}`,
          action: 'delete',
          target: {
            type: 'file',
            path: file
          },
          dependencies: [],
          estimatedDuration: '1m',
          requiredTools: ['file-delete']
        });
      }
    }

    return steps;
  }

  /**
   * Generate steps for read intent
   */
  generateReadSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    if (analysis.entities.files.length > 0) {
      for (const file of analysis.entities.files) {
        steps.push({
          id: `step-${stepId++}`,
          description: `Read file: ${file}`,
          action: 'execute',
          target: {
            type: 'file',
            path: file
          },
          dependencies: [],
          estimatedDuration: '30s',
          requiredTools: ['file-read']
        });
      }
    } else {
      steps.push({
        id: `step-${stepId++}`,
        description: `Read: ${analysis.goal}`,
        action: 'execute',
        target: {
          type: 'unknown',
          details: analysis.goal
        },
        dependencies: [],
        estimatedDuration: '2m',
        requiredTools: []
      });
    }

    return steps;
  }

  /**
   * Generate steps for search intent
   */
  generateSearchSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    steps.push({
      id: `step-${stepId++}`,
      description: `Search for: ${analysis.goal}`,
      action: 'execute',
      target: {
        type: 'search',
        query: analysis.goal
      },
      dependencies: [],
      estimatedDuration: '2m',
      requiredTools: ['file-search']
    });

    return steps;
  }

  /**
   * Generate steps for execute intent
   */
  generateExecuteSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    steps.push({
      id: `step-${stepId++}`,
      description: `Execute: ${analysis.goal}`,
      action: 'execute',
      target: {
        type: 'command',
        command: analysis.goal
      },
      dependencies: [],
      estimatedDuration: '5m',
      requiredTools: ['execute-command']
    });

    return steps;
  }

  /**
   * Generate steps for analyze intent
   */
  generateAnalyzeSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    steps.push({
      id: `step-${stepId++}`,
      description: `Analyze: ${analysis.goal}`,
      action: 'execute',
      target: {
        type: 'analysis',
        details: analysis.goal
      },
      dependencies: [],
      estimatedDuration: '3m',
      requiredTools: ['file-read']
    });

    return steps;
  }

  /**
   * Generate generic steps for unknown intents
   */
  generateGenericSteps(analysis, startStepId) {
    const steps = [];
    let stepId = startStepId;

    steps.push({
      id: `step-${stepId++}`,
      description: `Process: ${analysis.goal}`,
      action: 'execute',
      target: {
        type: 'generic',
        details: analysis.goal
      },
      dependencies: [],
      estimatedDuration: '5m',
      requiredTools: []
    });

    return steps;
  }

  /**
   * Apply constraints to the plan
   */
  applyConstraints(steps, constraints) {
    let constrainedSteps = [...steps];

    if (constraints.maxSteps && constrainedSteps.length > constraints.maxSteps) {
      constrainedSteps = constrainedSteps.slice(0, constraints.maxSteps);
    }

    return constrainedSteps;
  }

  /**
   * Calculate total estimated duration
   */
  calculateTotalDuration(steps) {
    let totalMinutes = 0;

    for (const step of steps) {
      const durationMatch = step.estimatedDuration.match(/(\d+)([mh])/i);
      if (durationMatch) {
        const value = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();
        totalMinutes += unit === 'h' ? value * 60 : value;
      }
    }

    if (totalMinutes > 60) {
      return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
    }
    return `${totalMinutes}m`;
  }

  /**
   * Validate the plan
   */
  async validatePlan(plan) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Check for circular dependencies
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (stepId) => {
      visited.add(stepId);
      recursionStack.add(stepId);

      const step = plan.steps.find(s => s.id === stepId);
      if (step) {
        for (const dep of step.dependencies) {
          if (!visited.has(dep)) {
            if (hasCycle(dep)) return true;
          } else if (recursionStack.has(dep)) {
            return true;
          }
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const step of plan.steps) {
      if (!visited.has(step.id) && hasCycle(step.id)) {
        validation.isValid = false;
        validation.errors.push(`Circular dependency detected involving step ${step.id}`);
      }
    }

    // Verify all dependencies exist
    const stepIds = new Set(plan.steps.map(s => s.id));
    for (const step of plan.steps) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) {
          validation.warnings.push(`Step ${step.id} depends on non-existent step ${dep}`);
        }
      }
    }

    // Check tool availability
    for (const step of plan.steps) {
      if (step.requiredTools) {
        for (const toolName of step.requiredTools) {
          if (!this.engine.getTool(toolName)) {
            validation.warnings.push(`Required tool ${toolName} not available for step ${step.id}`);
          }
        }
      }
    }

    return {
      ...plan,
      validation
    };
  }

  /**
   * Generate error suggestions
   */
  generateErrorSuggestions(error) {
    const suggestions = [];

    if (error.message.includes('complex')) {
      suggestions.push('Consider breaking the goal into smaller, more specific tasks');
    }

    if (error.message.includes('tool')) {
      suggestions.push('Some required tools may not be available');
    }

    suggestions.push('Try rephrasing the goal with more specific details');
    suggestions.push('Check if a skill exists that handles this type of task');

    return suggestions;
  }

  /**
   * Get planning history
   */
  getHistory() {
    return this.planningHistory;
  }

  /**
   * Clear planning history
   */
  clearHistory() {
    this.planningHistory = [];
  }
}

module.exports = PlannerAgent;
